---
'@marinoscar/platform-web': patch
'@marinoscar/platform-contract': patch
'@marinoscar/platform-cli': patch
---

Finish the identity slice move (#727): the reference app now imports identity only from `@marinoscar/platform-{api,web,contract}/identity`, so the web identity catalog's examples point at the app's real uses (`App.tsx`, and one example per data hook in `apps/web/src/identity/dataHookExamples.tsx`), the identity hook, page, guard and component suites the app kept run in `platform-web`'s own tests (with a `fakeIdentityApi` test helper), and comments naming the app's old identity paths point at the packages. No API change.
