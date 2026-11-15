---
"@marinoscar/platform-ai-providers": patch
"@marinoscar/platform-api": patch
---

OpenAI models of GPT-6 and every later generation (`gpt-6-luna`, `gpt-6.1-sol`, `gpt-7-mini`, ...) are classified like GPT-5 (reasoning, multimodal; `-chat` variants as chat), instead of arriving `unclassified` with no capability and unable to be enabled. The starter's `PrismaService` gains `forOrg`, which the AI, storage and credentials slices call through `PLATFORM_PRISMA`; without it, an app started from the starter fails the AI usage report with "this.prisma.forOrg is not a function". A starter test pins every method the slices call on the port.
