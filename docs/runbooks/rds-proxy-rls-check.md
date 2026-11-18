# Runbook: Check RDS Proxy against transaction-local row-level security

This is a **manual** procedure, to be run once in an AWS account by the owner. It answers the one spike question
that cannot be answered without AWS ([ADR 0002](../adr/0002-database-packaging-and-rls.md#q6-rds-proxy-pinning-unmeasured),
Q6) and one related question about RDS's master user:

1. **Does RDS Proxy pin a client connection to a database connection when the application scopes a request with
   `set_config('app.org_id', ..., true)` inside a transaction?** Pinning is not a correctness problem (the contract
   stays safe), it is a capacity problem: a pinned connection cannot be shared, so the proxy stops multiplexing.
2. **Can the RDS master user hold or grant `BYPASSRLS`?** This decides whether bypass option C
   (a `BYPASSRLS` login) is even possible on RDS. The chosen option, A, does not need it.

**Do not block anything on this.** Until the outcome is recorded below, the working assumption is
**PgBouncer on ECS** in front of RDS, not RDS Proxy. Record the outcome so the assumption can be replaced by a fact.

Who runs it: the platform owner, with permission to create an RDS instance, an RDS Proxy, an IAM role, a Secrets
Manager secret, an EC2 instance and read CloudWatch. Time: about 45 minutes. Cost: a few US dollars if the resources
are deleted the same day (a `db.t4g.micro` instance, a proxy, a `t3.micro`).

Source of truth for every claim below:

- [`spike/rds-proxy-check.mjs`](../../spike/rds-proxy-check.mjs): the workload, its phases and its assertions.
- [`spike/lib/rls.mjs`](../../spike/lib/rls.mjs): the `set_config` calls the application will make.
- [`spike/results/q5-rls.txt`](../../spike/results/q5-rls.txt): the PgBouncer results this procedure is compared with.
- The ADR's "The RLS contract" section: why the settings are transaction-local.

---

## 1. What is being measured

The workload runs three timed phases **through the proxy**, each against the same two-org dataset:

| Phase | What it does | Expected on RDS Proxy |
|---|---|---|
| `P0-plain-queries` | Plain `SELECT`s on a table without RLS, no `set_config` | **Control.** If this pins, the cause is Prisma or `pg` (for example prepared statements), not RLS |
| `P1-transaction-local-scope` | The real workload: per-operation `BEGIN; set_config(..., true); query; COMMIT` and interactive transactions, two orgs interleaved, 8 concurrent workers | The question. The script itself asserts zero cross-org rows |
| `P2-session-level-set-POSITIVE-CONTROL` | `set_config(..., false)` (a session-level setting) | **Positive control.** Expected to pin. If it does **not** pin, your metric reading is wrong |

Pinning is read from CloudWatch and the proxy log for each phase's exact window, which the script prints.

## 2. Prerequisites

- An AWS account and region; the AWS CLI configured. Pick a VPC with at least two subnets in different
  availability zones (RDS Proxy requires that). The default VPC is fine for a one-off.
- A machine **inside that VPC** to run the workload (an EC2 `t3.micro` with Node 22 or newer works). RDS Proxy is
  never publicly reachable.
- The repository checked out on that machine, `npm ci` run at its root, and `cd apps/api && npx prisma generate` run
  once (only so `prisma` and `@prisma/adapter-pg` resolve).
- Security groups: the machine may reach the proxy and the database on 5432; the proxy may reach the database on 5432.

Use placeholders for the names below and substitute your own. Never paste a password into a file in the repository.

## 3. Create the resources

### 3.1 RDS PostgreSQL 16

```bash
aws rds create-db-instance \
  --db-instance-identifier rls-check \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro --allocated-storage 20 \
  --master-username rlsadmin --manage-master-user-password \
  --no-publicly-accessible \
  --vpc-security-group-ids <db-sg-id> --db-subnet-group-name <subnet-group>
aws rds wait db-instance-available --db-instance-identifier rls-check
aws rds describe-db-instances --db-instance-identifier rls-check \
  --query 'DBInstances[0].[Endpoint.Address,MasterUserSecret.SecretArn,EngineVersion]'
```

`--manage-master-user-password` keeps the master password in Secrets Manager; fetch it for the next steps with
`aws secretsmanager get-secret-value --secret-id <MasterUserSecret.SecretArn> --query SecretString --output text`.
Write down the **DB endpoint** and the **engine version** (the check records the server version too).

### 3.2 The application role's secret

The workload creates a role `pp_5_1_rls_app` (`LOGIN NOSUPERUSER NOBYPASSRLS`) with a password **you choose**, and
the proxy must authenticate as that role. Create a secret holding exactly that pair first:

```bash
aws secretsmanager create-secret --name rls-check/app-role \
  --secret-string '{"username":"pp_5_1_rls_app","password":"<choose-a-long-random-password>"}'
```

### 3.3 The proxy

```bash
aws rds create-db-proxy \
  --db-proxy-name rls-check --engine-family POSTGRESQL \
  --auth '[{"AuthScheme":"SECRETS","SecretArn":"<app-role-secret-arn>","IAMAuth":"DISABLED","ClientPasswordAuthType":"POSTGRES_SCRAM_SHA_256"}]' \
  --role-arn <proxy-role-arn> \
  --vpc-subnet-ids <subnet-a> <subnet-b> --vpc-security-group-ids <proxy-sg-id> \
  --require-tls --debug-logging
aws rds register-db-proxy-targets --db-proxy-name rls-check --db-instance-identifiers rls-check
aws rds describe-db-proxy-targets --db-proxy-name rls-check \
  --query 'Targets[].[TargetHealth.State,TargetHealth.Reason]'
aws rds describe-db-proxies --db-proxy-name rls-check --query 'DBProxies[0].Endpoint'
```

- `<proxy-role-arn>` is an IAM role the proxy assumes to read the secret (`secretsmanager:GetSecretValue`, plus
  `kms:Decrypt` if the secret uses a customer key).
- `--debug-logging` is what writes the "pinned" lines to the log group `/aws/rds/proxy/rls-check`. It logs SQL text;
  use a throwaway database only.
- Wait until the target health is `AVAILABLE`. It can show `UNAVAILABLE` with a reason until the application role
  exists in the database; step 4 creates it, then re-check.
- Write down the **proxy endpoint**.

## 4. Run the workload

On the machine in the VPC, with the **DB endpoint** for the admin URL and the **proxy endpoint** for the pooled
connection:

```bash
export CHECK_ADMIN_URL='postgresql://rlsadmin:<master-password>@<db-endpoint>:5432/postgres'
export CHECK_APP_PASSWORD='<the password from step 3.2>'
export CHECK_PROXY_HOST='<proxy-endpoint>'
export CHECK_SSL=no-verify          # TLS on, without installing the RDS CA bundle (use "require" if you have it)
export CHECK_PHASE_SECONDS=150      # keep >= 120: the CloudWatch pinning metric has one-minute points
export CHECK_PROBE_BYPASSRLS=1      # also tries CREATE ROLE ... BYPASSRLS as the master user
node spike/rds-proxy-check.mjs 2>&1 | tee rds-proxy-check.out
```

The script never prints a password. It prepares two disposable tables and the role over the **direct** endpoint,
runs the three phases through the proxy, prints one `WINDOW <phase> <start> <end>` line per phase (UTC), asserts
tenant isolation, cleans up, and exits non-zero if an assertion fails.

Expected, whatever the pinning result: `P1: every request saw ONLY its own org (zero cross-org rows)` and
`P1: an unscoped client through the pooler still sees nothing (fail-closed)` both **PASS**. If either fails, stop:
that is a correctness finding, not a capacity one. Record it and do not adopt RDS Proxy.

Also keep these lines from the output:

```
FACT admin_bypassrls=<true|false> admin_superuser=<true|false>
FACT create_role_bypassrls=<created|refused: ...>
FACT p2_cross_org_rows=<n>
```

## 5. Read the pinning evidence

For each `WINDOW` line, with its start and end as `<start>` and `<end>`:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS --metric-name DatabaseConnectionsCurrentlySessionPinned \
  --dimensions Name=ProxyName,Value=rls-check \
  --start-time <start> --end-time <end> --period 60 --statistics Maximum Average
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS --metric-name DatabaseConnections \
  --dimensions Name=ProxyName,Value=rls-check \
  --start-time <start> --end-time <end> --period 60 --statistics Maximum
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS --metric-name ClientConnections \
  --dimensions Name=ProxyName,Value=rls-check \
  --start-time <start> --end-time <end> --period 60 --statistics Maximum
```

and the proxy log for the same window:

```bash
aws logs filter-log-events --log-group-name /aws/rds/proxy/rls-check \
  --start-time <start-epoch-ms> --end-time <end-epoch-ms> --filter-pattern pinned
```

Read them as:

| Observation | Meaning |
|---|---|
| `DatabaseConnectionsCurrentlySessionPinned` stays **0** in P1 and `DatabaseConnections` (database side) is far below `ClientConnections` (8 workers plus the pool) | **RDS Proxy does not pin on transaction-local `set_config`.** It is usable for the RLS design |
| The metric rises in P1 to about the number of workers, and the log has `pinned` lines whose reason names the statement or a prepared statement | **It pins.** Look at the reason: if P0 pins for the same reason, the cause is Prisma/`pg`, not RLS |
| The metric is 0 in P2 | The positive control failed: the metric or the window is wrong. Repeat before concluding anything |
| `P2 cross_org_rows` is `0` | The proxy pinned the session in P2 (so session state was safe for that client). Expected on RDS Proxy |
| `P2 cross_org_rows` is positive | The proxy multiplexed without pinning in P2: session-level settings would leak. This is the case the transaction-local rule exists for |

The metric lags by a minute or two: wait before reading, and always use the same window as the `WINDOW` line.

## 6. Record the outcome

Copy this table into a comment on issue #708 (or a follow-up ADR if it changes a decision) and fill it in:

| Item | Value |
|---|---|
| Date, region | |
| RDS engine version | |
| `P0` pinned (metric max, log lines) | |
| `P1` pinned (metric max, log lines, reason text) | |
| `P2` pinned (positive control) | |
| `P1` zero cross-org rows, unscoped fail-closed | pass / fail |
| `P2` cross-org rows | |
| Master user `rolbypassrls`, `rolsuper`, `rds_superuser` member | |
| `CREATE ROLE ... BYPASSRLS` as master | created / refused |
| Conclusion | RDS Proxy usable / use PgBouncer on ECS |

Decision rules:

- **`P1` does not pin and passes:** RDS Proxy is acceptable for the SaaS stages that need a pooler. Update the
  spec's "First SaaS on AWS" paragraph from "verify" to the measured result.
- **`P1` pins:** keep **PgBouncer on ECS** (transaction pooling), as already assumed. Nothing in the contract changes.
- **`P1` fails the isolation assertion:** do not use RDS Proxy; open an issue with the output.
- **`CREATE ROLE ... BYPASSRLS` is refused for the master user:** option C is impossible on RDS, which confirms the
  decision for option A. If it is allowed, option C remains a documented fallback, not the default.

## 7. Backup and restore are not tested through the proxy

Do **not** point `pg_dump` or `pg_restore` at the proxy. The dump and restore need the connection startup option
`app.rls_bypass=on` (`PGOPTIONS`), which a pooler may refuse (PgBouncer 1.22 answers
`unsupported startup parameter in options`) and which RDS Proxy may treat as a pinning reason (check the AWS
documentation for your engine version). They
connect straight to the **DB endpoint**, as `POSTGRES_HOST` does today. If you want to confirm the option reaches RDS
itself, run against the DB endpoint:

```bash
PGOPTIONS='-c app.rls_bypass=on' psql "host=<db-endpoint> user=pp_5_1_rls_app dbname=postgres sslmode=require" \
  -Atc "select current_setting('app.rls_bypass', true)"
```

It prints `on`. (Run it before the workload's cleanup, with `CHECK_KEEP=1`, or recreate the role.)

## 8. Clean up

```bash
aws rds delete-db-proxy --db-proxy-name rls-check
aws rds delete-db-instance --db-instance-identifier rls-check --skip-final-snapshot --delete-automated-backups
aws secretsmanager delete-secret --secret-id rls-check/app-role --force-delete-without-recovery
```

Then delete the EC2 instance, the proxy's IAM role and the security groups you created. The workload already dropped
its tables and the `pp_5_1_rls_app` role (unless `CHECK_KEEP=1` was set).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `connect ETIMEDOUT` to the proxy | The machine is not in the VPC, or the proxy security group does not allow it on 5432 |
| `password authentication failed for user "pp_5_1_rls_app"` through the proxy | The secret in step 3.2 does not hold the same password as `CHECK_APP_PASSWORD`; fix the secret (the proxy caches it for a short time) |
| The proxy target stays `UNAVAILABLE` | The role does not exist yet (run step 4 once, then re-check), or the proxy's IAM role cannot read the secret |
| `no pg_hba.conf entry ... no encryption` | The proxy requires TLS: set `CHECK_SSL=no-verify` or `require` |
| `permission denied to create role` on the probe | Expected on RDS if the master user cannot create `BYPASSRLS` roles; this is a finding, record it |
| The metric is empty | CloudWatch has not published yet (wait two minutes), or the dimension `ProxyName` is wrong |
| `CHECK_ADMIN_URL is required` | The environment variables of step 4 were not exported in this shell |

A dry run of the script against PgBouncer (a stand-in, not RDS Proxy) is recorded in
[`spike/results/rds-proxy-check.dry-run-pgbouncer.txt`](../../spike/results/rds-proxy-check.dry-run-pgbouncer.txt).
