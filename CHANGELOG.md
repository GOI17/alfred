# Changelog

## [0.7.3](https://github.com/GOI17/alfred/compare/v0.7.2...v0.7.3) (2026-10-18)


### Features

* **homebrew:** package verified public runtime release assets ([#220](https://github.com/GOI17/alfred/issues/220)) ([03715d6](https://github.com/GOI17/alfred/commit/03715d62cab0c9084fbf2998e4cfcf5ebdd702ae))
* **memory:** capture durable memories proactively ([#212](https://github.com/GOI17/alfred/issues/212)) ([405fbfd](https://github.com/GOI17/alfred/commit/405fbfde9630e6a2bb4f8210b2f9580ad6838eed))
* **memory:** show history and observed agent presence ([#211](https://github.com/GOI17/alfred/issues/211)) ([244d33a](https://github.com/GOI17/alfred/commit/244d33a7446d6088736b87f1200b6f8aca60c55a))
* **memory:** simplify web onboarding agent type ([#203](https://github.com/GOI17/alfred/issues/203)) ([aed0640](https://github.com/GOI17/alfred/commit/aed06409b339c6fef59ac615d5dfca4e079ade21))
* **runtime:** enforce Alfred-first instruction loading and project consent ([#218](https://github.com/GOI17/alfred/issues/218)) ([e9e4e3e](https://github.com/GOI17/alfred/commit/e9e4e3e0a8afce432a15a8e4d3f3ff8cb9bdbf67))
* **skills:** add GOAL, LOOP, and ULW with role-safe routing ([#205](https://github.com/GOI17/alfred/issues/205)) ([84a5e0a](https://github.com/GOI17/alfred/commit/84a5e0a0e39afb5bb0f2e683f3f4e286ce436b55))


### Bug Fixes

* **deploy:** align MCP production client check ([#216](https://github.com/GOI17/alfred/issues/216)) ([2ebe950](https://github.com/GOI17/alfred/commit/2ebe950a295880ffa09383da7b2c3272f9c03888))
* **memory-server:** allow validated OAuth callback redirects ([#188](https://github.com/GOI17/alfred/issues/188)) ([dc56811](https://github.com/GOI17/alfred/commit/dc5681127f1231110ceb740dfe10a6287ce2583d))
* **memory-server:** permit OpenAI OAuth relay chain ([#190](https://github.com/GOI17/alfred/issues/190)) ([8169daf](https://github.com/GOI17/alfred/commit/8169dafa0da2d91a4d49c6e75be314b67e34d45b))
* **orchestrator:** require native Git worktrees before repository writes ([#209](https://github.com/GOI17/alfred/issues/209)) ([6d218e1](https://github.com/GOI17/alfred/commit/6d218e188c2c349454573e9c917c961b0b745d59))

## [0.7.2](https://github.com/GOI17/alfred/compare/v0.7.1...v0.7.2) (2026-09-05)


### Features

* **memory:** add Console API key and logout controls ([#163](https://github.com/GOI17/alfred/issues/163)) ([c6f0495](https://github.com/GOI17/alfred/commit/c6f0495408ce3c8e178a0d4ea2ebbc5b27e626a5)), closes [#161](https://github.com/GOI17/alfred/issues/161)
* **memory:** publish Alfred Memory plugin foundation ([#169](https://github.com/GOI17/alfred/issues/169)) ([a5a560d](https://github.com/GOI17/alfred/commit/a5a560da0b6b1167f817216a047e0da533abc769)), closes [#167](https://github.com/GOI17/alfred/issues/167)


### Bug Fixes

* **codex:** activate Orchestrator in the main session ([#186](https://github.com/GOI17/alfred/issues/186)) ([053785f](https://github.com/GOI17/alfred/commit/053785f2379833601278b5112a2eee7fdfb07ac8))
* **deploy:** declare MCP test dependency ([#171](https://github.com/GOI17/alfred/issues/171)) ([a54928b](https://github.com/GOI17/alfred/commit/a54928bb56545572beb6e07495099d331d138343))
* **deploy:** include MCP workspace dependencies ([#170](https://github.com/GOI17/alfred/issues/170)) ([b42ea8a](https://github.com/GOI17/alfred/commit/b42ea8aff67244fc4fb0f6a3fe1291cb56416135)), closes [#167](https://github.com/GOI17/alfred/issues/167)
* **docker:** install MCP dependency graph ([#185](https://github.com/GOI17/alfred/issues/185)) ([aa79590](https://github.com/GOI17/alfred/commit/aa7959058adc08fae66ca63e7e6cba2190c228d4))
* **memory-server:** classify MCP failure stages ([#183](https://github.com/GOI17/alfred/issues/183)) ([2568b08](https://github.com/GOI17/alfred/commit/2568b08fe1ad7460b373f39bb2fa26c73bb7a323))
* **memory-server:** publish MCP resource metadata path ([edd093d](https://github.com/GOI17/alfred/commit/edd093d1fc0eab49fb79b2e8a8bb465aec88de90)), closes [#175](https://github.com/GOI17/alfred/issues/175)
* **memory-server:** ship MCP transport in production ([#180](https://github.com/GOI17/alfred/issues/180)) ([af42bd3](https://github.com/GOI17/alfred/commit/af42bd36845a8fffb7a7b4d6cc00cc8c2148240e))
* **memory-server:** support PKCE public OAuth clients ([f7c13d9](https://github.com/GOI17/alfred/commit/f7c13d9d4078f0baa590f10560a7706fe52aa5c9)), closes [#177](https://github.com/GOI17/alfred/issues/177)
* **opencode:** preserve active model inheritance ([#173](https://github.com/GOI17/alfred/issues/173)) ([#174](https://github.com/GOI17/alfred/issues/174)) ([0eb1746](https://github.com/GOI17/alfred/commit/0eb17466f031903960e1e0e9084f3e12597cb2cc))
* **test:** match YAML OAuth scopes ([#172](https://github.com/GOI17/alfred/issues/172)) ([e9164a7](https://github.com/GOI17/alfred/commit/e9164a7bbb5c3da6e60760eaff610367806b82ca))

## [0.7.1](https://github.com/GOI17/alfred/compare/v0.7.0...v0.7.1) (2026-09-03)


### Features

* **release:** complete automatic publishing ([49e01a6](https://github.com/GOI17/alfred/commit/49e01a6b8df453bb6aa15fa7430d7a193b7c3bb9)), closes [#160](https://github.com/GOI17/alfred/issues/160)


### Bug Fixes

* restore Alfred Memory Custom GPT setup ([#165](https://github.com/GOI17/alfred/issues/165)) ([fb58a6e](https://github.com/GOI17/alfred/commit/fb58a6e9180faccb5216bd028967e400a936ca21)), closes [#162](https://github.com/GOI17/alfred/issues/162)
