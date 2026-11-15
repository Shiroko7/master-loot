# Dependency security maintenance

Use Node.js 24. Dependencies and lockfiles have been updated against the current advisory database. CI audits the full dependency graph and builds the application.

Run `npm ci`, `npm audit`, and `npm run build`.

The Owlbear SDK currently pins an affected UUID version. A scoped override supplies UUID 11.1.1 or newer; its `v4` API stays compatible. Remove the override after the SDK updates its own requirement.

Run `npm test` and `npm run test:browser` for the existing unit and browser suites.
