// The orchestration-boundary rules against violation fixtures (#739).

import {
  findOrchestrationViolations,
  isBannedOrchestrationPackage,
  orchestrationImportSpecifiers,
  type OrchestrationScannedFile,
} from './orchestration-boundary.suite';

const file = (rel: string, source: string): OrchestrationScannedFile => ({ rel, specifiers: orchestrationImportSpecifiers(source) });
const BASE = { allowedRoots: {} };
const EVOPATH = { allowedRoots: { '@langchain/langgraph': ['training-agents/'], '@langchain/core': ['training-agents/'] } };

describe('orchestration boundary rules', () => {
  it('reads import, re-export, side-effect, dynamic and require specifiers', () => {
    expect(
      orchestrationImportSpecifiers(
        "import { a } from 'langchain';\nexport * from '@langchain/core/runnables';\nimport 'langsmith';\nconst x = import('@ai-sdk/openai');\nrequire('@langchain/openai');",
      ),
    ).toEqual(['langchain', '@langchain/core/runnables', 'langsmith', '@ai-sdk/openai', '@langchain/openai']);
  });

  it('the base (no allowed roots) fails on a planted langchain import, and on every other orchestration package', () => {
    const violations = findOrchestrationViolations(
      {
        apiFiles: [
          file('features/summary.service.ts', "import { ChatOpenAI } from 'langchain/chat_models/openai';"),
          file('training-agents/graph.ts', "import { StateGraph } from '@langchain/langgraph';"),
          file('features/trace.ts', "import { Client } from 'langsmith';"),
          file('features/vercel.ts', "import { openai } from '@ai-sdk/openai';"),
          file('features/fine.ts', "import { AiService } from '@marinoscar/platform-api/ai';\n// langchain in prose"),
        ],
        webFiles: [],
        manifests: [],
      },
      BASE,
    );
    expect(violations).toEqual([
      'features/summary.service.ts: imports banned "langchain/chat_models/openai"',
      'training-agents/graph.ts: imports banned "@langchain/langgraph"',
      'features/trace.ts: imports banned "langsmith"',
      'features/vercel.ts: imports banned "@ai-sdk/openai"',
    ]);
  });

  it('allowed roots admit their packages under their prefixes only, and never a provider integration', () => {
    const violations = findOrchestrationViolations(
      {
        apiFiles: [
          file('training-agents/graph.ts', "import { StateGraph } from '@langchain/langgraph';\nimport { RunnableLambda } from '@langchain/core/runnables';"),
          file('coach/chat.service.ts', "import { StateGraph } from '@langchain/langgraph';"),
          file('training-agents/model.ts', "import { ChatOpenAI } from '@langchain/openai';"),
        ],
        webFiles: [],
        manifests: [],
      },
      EVOPATH,
    );
    expect(violations).toEqual([
      'coach/chat.service.ts: imports "@langchain/langgraph" outside training-agents/',
      'training-agents/model.ts: imports banned "@langchain/openai"',
    ]);
  });

  it('no web source may import any orchestration package, allowed or not', () => {
    expect(
      findOrchestrationViolations(
        { apiFiles: [], webFiles: [file('pages/Coach.tsx', "import { StateGraph } from '@langchain/langgraph';")], manifests: [] },
        EVOPATH,
      ),
    ).toEqual(['pages/Coach.tsx: a web source imports "@langchain/langgraph"']);
  });

  it('a manifest may declare only allowed orchestration packages', () => {
    const manifests = [{ path: 'apps/api/package.json', declared: ['@nestjs/core', '@langchain/langgraph', '@langchain/openai', 'langsmith', '@ai-sdk/react'] }];
    expect(findOrchestrationViolations({ apiFiles: [], webFiles: [], manifests }, EVOPATH)).toEqual([
      'apps/api/package.json: declares banned "@langchain/openai"',
      'apps/api/package.json: declares banned "langsmith"',
      'apps/api/package.json: declares banned "@ai-sdk/react"',
    ]);
    expect(findOrchestrationViolations({ apiFiles: [], webFiles: [], manifests }, BASE)).toHaveLength(4);
  });

  it('look-alikes and relative paths are not orchestration packages', () => {
    expect(isBannedOrchestrationPackage('langchain-community', BASE)).toBe(false);
    expect(isBannedOrchestrationPackage('langsmith', BASE)).toBe(true);
    expect(
      findOrchestrationViolations({ apiFiles: [file('a.ts', "import x from './langsmith';")], webFiles: [], manifests: [] }, BASE),
    ).toEqual([]);
  });

  it('a custom banned list replaces the default', () => {
    expect(isBannedOrchestrationPackage('llamaindex', { allowedRoots: {}, banned: ['llamaindex'] })).toBe(true);
    expect(isBannedOrchestrationPackage('langchain', { allowedRoots: {}, banned: ['llamaindex'] })).toBe(false);
  });
});
