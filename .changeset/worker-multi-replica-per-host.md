---
"@marinoscar/platform-infra": minor
"@marinoscar/platform-cli": patch
---

Run several worker nodes on one machine. `worker.compose.yml` now gives every replica its own state directory (an anonymous volume instead of one shared named volume, which made `--scale worker=N` start only one replica), and adds `WORKER_REPLICAS`, `WORKER_CPUS` and `WORKER_MEMORY` to `.env.worker.example`. A worker sizes its default concurrency and heap limit to its cgroup memory and CPU limits instead of the whole host, so replicas on a large machine no longer each assume they own all of it. A pidfile that names the current process is treated as stale, so a container restarted after SIGKILL or an OOM kill starts again instead of refusing to run.
