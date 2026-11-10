// =============================================================================
// Azure OpenAI provider adapter (issue #448, epic #421)
// =============================================================================
//
// OpenAI's models behind an Azure resource (data residency, enterprise
// agreements). Azure speaks OpenAI's wire protocol, so this adapter is
// composition, not a new mapping: the OpenAI adapter's shared pieces
// (`../openai/`) with Azure's differences plugged in.
//
//   azure-openai-settings.ts        the slot's apiVersion / apiStyle / deployments
//   azure-openai-client.factory.ts  `AzureOpenAI` per call: endpoint, api-version,
//                                   `api-key` header, no redirects
//   ../openai/openai-responses.engine.ts         apiStyle 'responses' (the default)
//   ../openai/openai-chat-completions.engine.ts  apiStyle 'chat_completions'
//
// DEPLOYMENTS. Azure routes by DEPLOYMENT NAME, not model id. A request's
// model id is looked up in the slot's `deployments` map (model id ->
// deployment name) and falls back to the id itself — Azure's common
// convention of naming a deployment after its model. The deployment name is
// what goes on the wire (`model` in the body; the SDK builds
// `/deployments/<name>/...` from it for Chat Completions and embeddings);
// the model id stays what telemetry, usage and the neutral response use.
//
// MODEL LIST. `GET /openai/models` is always called (it is also how a key is
// verified). When a `deployments` map is configured, ITS KEYS are the model
// list — Azure's data plane cannot enumerate a resource's deployments, and
// the listing it does return names every model the region offers, deployed
// or not. Without a map the listing is returned as-is and the administrator
// enables what is actually deployed.
//
// CLASSIFICATION. Azure models are OpenAI models, so model ids classify with
// OpenAI's own table (`classifyOpenAiModel`) minus `hosted_tools`, which this
// adapter does not run; an id the table does not know (`gpt-35-turbo`, a
// custom map key) is `null` — unclassified — for an administrator to decide.
//
// FLAGS (static, conservative — see docs/specs/ai-platform.md §2.24):
//   - `supportsPreviousResponseId: false`. Azure's Responses API does store
//     responses, but a flag is per ADAPTER while `apiStyle` is per slot, and
//     the Chat Completions style cannot chain; declaring `false` means the
//     tool loop always resends the full history, which works in both styles.
//   - `supportsHostedTools: false`. Azure's hosted-tool coverage varies by
//     region and api-version; none is mapped. A hosted tool reaching the port
//     directly is refused with AI_CAPABILITY_UNSUPPORTED.
//
// PORTS. `responses` and `embeddings`. Images and audio are deliberately
// absent for now (their Azure routing differs per api-version); presence is
// the declaration, so the registry stays truthful.
//
// STORAGE-OBJECT INPUTS (#441). Images by `presigned_url` (Azure fetches the
// signed URL), files `inline` (base64 `file_data`) — both engines deliver
// both, and nothing is uploaded to Azure, so nothing needs deleting.
// =============================================================================


import type { AiModelCapabilities } from '../../core/index';
import { NOOP_AI_LOGGER, type AiLogger, type AiTracer } from '../../core/index';
import type {
  AiCallContext,
  AiDiscoveredModel,
  AiKeyVerification,
  AiProviderAdapter,
  AiResponsesPort,
} from '../../core/index';
import type { AiFileInputStrategies } from '../../core/index';
import type { AiEmbeddingRequest, AiEmbeddingResult, AiEmbeddingsPort } from '../../core/index';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from '../../core/index';
import { OpenAiCallTelemetry } from '../openai-call-telemetry';
import { OpenAiChatCompletionsEngine } from '../openai-chat-completions.engine';
import { fromOpenAiEmbeddingResponse, toOpenAiEmbeddingRequest } from '../openai-embeddings.mapper';
import { mapOpenAiError } from '../openai-errors';
import { assertNoHostedTools } from '../openai-family-guards';
import { classifyOpenAiModel } from '../openai-model-catalog';
import { OpenAiResponsesEngine } from '../openai-responses.engine';
import { AzureOpenAiClientFactory } from './azure-openai-client.factory';
import {
  AZURE_OPENAI_FAMILY,
  AZURE_OPENAI_PROVIDER_ID,
  azureDeploymentFor,
  azureOpenAiSettings,
} from './azure-openai-settings';

/**
 * What {@link AzureOpenAiProviderAdapter} takes. Every member is optional.
 *
 * @stability experimental
 */
export interface AzureOpenAiProviderAdapterOptions {
  /** Builds the SDK client for each call; a fresh `AzureOpenAiClientFactory` by default. */
  clients?: Pick<AzureOpenAiClientFactory, 'create'>;
  /** Where the per-call debug line goes; nothing is logged when absent. */
  logger?: AiLogger;
  /** Starts the `ai.provider.call` spans; no span is started when absent. */
  tracer?: AiTracer;
}

/**
 * The Azure OpenAI provider adapter. Framework-free: build it with {@link createAzureOpenAiAdapter} or `new`; the platform registers a Nest subclass.
 *
 * @stability experimental
 */
export class AzureOpenAiProviderAdapter implements AiProviderAdapter {
  /** The provider id. */
  readonly id = AZURE_OPENAI_PROVIDER_ID;
  /** The name shown to administrators. */
  readonly displayName = 'Azure OpenAI';

  /** Static and conservative — see the file header. */
  readonly supportsPreviousResponseId = false;

  /** No hosted tool is mapped for Azure — see the file header. */
  readonly supportsHostedTools = false;

  /** Images by presigned URL, files inline — see the file header. */
  readonly fileInputStrategy: AiFileInputStrategies = { image: 'presigned_url', file: 'inline' };

  /** The responses port: create and stream, over the configured API style. */
  readonly responses: AiResponsesPort = {
    create: (req, ctx) => this.create(req, ctx),
    stream: (req, ctx) => this.stream(req, ctx),
  };

  /** The embeddings port. */
  readonly embeddings: AiEmbeddingsPort = {
    embed: (req, ctx) => this.embed(req, ctx),
  };

  private readonly logger: AiLogger;
  private readonly telemetry: OpenAiCallTelemetry;
  private readonly clients: Pick<AzureOpenAiClientFactory, 'create'>;
  private readonly responsesEngine: OpenAiResponsesEngine;
  private readonly chatEngine: OpenAiChatCompletionsEngine;

  /**
   * @param options - the client factory, logger and tracer; all optional.
   */
  constructor(options: AzureOpenAiProviderAdapterOptions = {}) {
    this.clients = options.clients ?? new AzureOpenAiClientFactory();
    this.logger = options.logger ?? NOOP_AI_LOGGER;
    this.telemetry = new OpenAiCallTelemetry(AZURE_OPENAI_FAMILY, this.logger, undefined, options.tracer);
    const client = (ctx: AiCallContext) => this.clients.create(ctx, azureOpenAiSettings(ctx.providerSettings));

    this.responsesEngine = new OpenAiResponsesEngine({
      family: AZURE_OPENAI_FAMILY,
      telemetry: this.telemetry,
      logger: this.logger,
      client,
      classify: (modelId) => this.classifyModel(modelId),
    });
    this.chatEngine = new OpenAiChatCompletionsEngine({
      family: AZURE_OPENAI_FAMILY,
      telemetry: this.telemetry,
      client,
      // Azure's current name for the limit, and the only one its reasoning deployments accept.
      tokenParameter: 'max_completion_tokens',
    });
  }


  /** The capabilities of a model id, from the OpenAI classifier table; `null` when unknown. */
  classifyModel(modelId: string): AiModelCapabilities | null {
    const caps = classifyOpenAiModel(modelId);

    if (!caps) return null;

    return { ...caps, capabilities: caps.capabilities.filter((capability) => capability !== 'hosted_tools') };
  }

  /** Lists the models the resource serves. */
  async listModels(ctx: AiCallContext): Promise<AiDiscoveredModel[]> {
    return this.telemetry.call('models.list', undefined, ctx, async () => {
      const settings = azureOpenAiSettings(ctx.providerSettings);
      const client = this.clients.create(ctx, settings);
      const listed: AiDiscoveredModel[] = [];

      for await (const model of client.models.list({ signal: ctx.signal })) {
        listed.push({
          id: model.id,
          ...(model.owned_by ? { ownedBy: model.owned_by } : {}),
          ...(typeof model.created === 'number' ? { createdAt: new Date(model.created * 1000) } : {}),
        });
      }

      const configured = Object.keys(settings.deployments);

      return configured.length > 0 ? configured.map((id) => ({ id })) : listed;
    });
  }

  /**
   * `GET /openai/models` with the key. A rejected key is an ANSWER, as is any
   * other failure — mapped to its code — so the admin UI never has to catch.
   */
  async verifyKey(ctx: AiCallContext): Promise<AiKeyVerification> {
    try {
      await this.telemetry.call('verify_key', undefined, ctx, async () => {
        await this.clients.create(ctx, azureOpenAiSettings(ctx.providerSettings)).models.list({ signal: ctx.signal });
      });

      return { ok: true };
    } catch (err) {
      const mapped = mapOpenAiError(err, AZURE_OPENAI_FAMILY);

      return mapped.code === 'AI_KEY_INVALID'
        ? { ok: false, code: 'AI_KEY_INVALID' }
        : { ok: false, code: mapped.code, detail: mapped.message };
    }
  }

  // ---- responses port -------------------------------------------------------

  private create(req: AiResponseRequest, ctx: AiCallContext): Promise<AiResponse> {
    assertNoHostedTools(req, this.id);

    const settings = azureOpenAiSettings(ctx.providerSettings);
    const opts = { wireModel: azureDeploymentFor(settings, req.model) };

    return settings.apiStyle === 'chat_completions'
      ? this.chatEngine.create(req, ctx, opts)
      : this.responsesEngine.create(req, ctx, opts);
  }

  private stream(req: AiResponseRequest, ctx: AiCallContext): AsyncIterable<AiStreamEvent> {
    const settings = azureOpenAiSettings(ctx.providerSettings);
    const opts = { wireModel: azureDeploymentFor(settings, req.model) };
    const run = () =>
      settings.apiStyle === 'chat_completions'
        ? this.chatEngine.stream(req, ctx, opts)
        : this.responsesEngine.stream(req, ctx, opts);

    return (async function* () {
      assertNoHostedTools(req, AZURE_OPENAI_PROVIDER_ID);

      yield* run();
    })();
  }

  // ---- embeddings port ------------------------------------------------------

  /** `POST /openai/deployments/<deployment>/embeddings`, floats on the wire. */
  private embed(req: AiEmbeddingRequest, ctx: AiCallContext): Promise<AiEmbeddingResult> {
    return this.telemetry.call('embeddings.create', req.model, ctx, async () => {
      const settings = azureOpenAiSettings(ctx.providerSettings);
      const body = { ...toOpenAiEmbeddingRequest(req, AZURE_OPENAI_FAMILY), model: azureDeploymentFor(settings, req.model) };

      const { data, request_id } = await this.clients
        .create(ctx, settings)
        .embeddings.create(body, { signal: ctx.signal })
        .withResponse();

      return fromOpenAiEmbeddingResponse(data, {
        request: req,
        providerRequestId: request_id,
        family: AZURE_OPENAI_FAMILY,
      });
    });
  }
}

/**
 * Builds the Azure OpenAI adapter for a plain Node process: no DI, no registry. Each call
 * gets its key and settings through its `AiCallContext`.
 *
 * @example
 * ```ts
 * const adapter = createAzureOpenAiAdapter({ logger: console });
 * const response = await adapter.responses.create(request, { apiKey, requestId: 'r1' });
 * ```
 *
 * @param options - the client factory, logger and tracer; all optional.
 * @returns a new adapter.
 *
 * @stability experimental
 */
export function createAzureOpenAiAdapter(options: AzureOpenAiProviderAdapterOptions = {}): AzureOpenAiProviderAdapter {
  return new AzureOpenAiProviderAdapter(options);
}
