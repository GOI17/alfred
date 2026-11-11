# Changelog

## [1.6.0](https://github.com/GOI17/alfred/compare/v1.5.0...v1.6.0) (2026-11-11)


### Features

* **ui:** replace native confirmations with styled dialogs ([f66f23f](https://github.com/GOI17/alfred/commit/f66f23fb7298c82e63bba8d710309f8fe4ede09c))
* **workspace:** expand Git workbench and safe change management ([346f0b5](https://github.com/GOI17/alfred/commit/346f0b59952c5e5d2ec3906baf5b7f4303aa4ae7))
* **workspace:** track token usage and discover context capacity ([c19f223](https://github.com/GOI17/alfred/commit/c19f223db75f4c3019dad844681537156eaa2733))


### Bug Fixes

* **workspace:** replace native Git prompts with safe dialogs ([d5dd64b](https://github.com/GOI17/alfred/commit/d5dd64be6eb0abd6cfb41c17f0556d95393c688a))

## [1.5.0](https://github.com/GOI17/alfred/compare/v1.4.1...v1.5.0) (2026-11-09)


### Features

* **workspace:** authorize external file references per conversation ([06dedab](https://github.com/GOI17/alfred/commit/06dedab8814a1200bfa1a1ac9ad4cad5adbe545e))
* **workspace:** quote selected chat text and navigate to source ([0539344](https://github.com/GOI17/alfred/commit/053934415f22812adfe92ee73591104a954c1a32))


### Bug Fixes

* focus terminal and constrain message navigation ([a496c77](https://github.com/GOI17/alfred/commit/a496c77443b420c1b66ff7e7c5cd915a017eb1c9))

## [1.4.1](https://github.com/GOI17/alfred/compare/v1.4.0...v1.4.1) (2026-11-05)


### Bug Fixes

* **workspace:** open linked files in viewer and recover expired authentication ([587c767](https://github.com/GOI17/alfred/commit/587c76762bb85d0a08d1e860a39e7f70a6c39147))

## [1.4.0](https://github.com/GOI17/alfred/compare/v1.3.0...v1.4.0) (2026-11-05)


### Features

* **workspace:** add file tools and optimize chat streaming and persistence ([c65ea10](https://github.com/GOI17/alfred/commit/c65ea10684547d04becaef94549c4073bde5298f))
* **workspace:** breadcrumb worktree picker and chat input history ([dde1f77](https://github.com/GOI17/alfred/commit/dde1f776121904d48a469abecda213c9c7dc7277))
* **workspace:** refine UI controls and regenerate conversation titles ([6579637](https://github.com/GOI17/alfred/commit/6579637c08cab54b7d1ad0f6aeb222fa56cd069d))


### Bug Fixes

* **workspace:** anchor message navigation across lazy layout changes ([f510219](https://github.com/GOI17/alfred/commit/f51021900582e3abc83505a4b0536b59911f8de0))
* **workspace:** restore virtual reading anchors and align UI regression tests ([a275863](https://github.com/GOI17/alfred/commit/a2758633e6150dd6227fd171bfa3a277ffc9ae7e))

## [1.3.0](https://github.com/GOI17/alfred/compare/v1.2.0...v1.3.0) (2026-11-04)


### Features

* **workspace:** add cd command with directory autocomplete ([f440663](https://github.com/GOI17/alfred/commit/f4406635b8e70f6c9d5dde397c72d0f872e0bbc5))
* **workspace:** resume pending work and request capability access ([abf5077](https://github.com/GOI17/alfred/commit/abf507766a17adac5ef38d553e7e69661ae8915a))
* **workspace:** run as daemon with stop and restart ([ab67f59](https://github.com/GOI17/alfred/commit/ab67f59be588c44796158a53d164172d27ddae8b))
* **workspace:** sync sidebar, context usage and compaction improvements ([ed00597](https://github.com/GOI17/alfred/commit/ed00597af65dfc24b3e8cd3c9833fec7f38e8301))
* **workspace:** sync sidebar, context usage and compaction improvements ([#243](https://github.com/GOI17/alfred/issues/243)) ([b0066b5](https://github.com/GOI17/alfred/commit/b0066b50cbde97241c54aefcaac691189e83cdd8))


### Bug Fixes

* **workspace:** filter agents by working waiting and finished status ([7e0286d](https://github.com/GOI17/alfred/commit/7e0286d188e8d4a880a75199c132217df4ca6437))
* **workspace:** limit agent popovers to dock hover and prevent overlap ([5ca7c83](https://github.com/GOI17/alfred/commit/5ca7c834559ab4dd8fbdffa2874e9fafab7bf607))
* **workspace:** navigate agent previews and dismiss seen completions ([c878316](https://github.com/GOI17/alfred/commit/c878316873648e1288ffec7d0da96c8aeb27a6d6))

## [1.2.0](https://github.com/GOI17/alfred/compare/v1.1.0...v1.2.0) (2026-10-24)


### Features

* offer Workspace, Memory and Agent Harness independently ([#241](https://github.com/GOI17/alfred/issues/241)) ([354f13b](https://github.com/GOI17/alfred/commit/354f13b7280a58c44eb14e5d5645e23fe5169b25))

## [1.1.0](https://github.com/GOI17/alfred/compare/v1.0.1...v1.1.0) (2026-10-24)


### Features

* **setup:** offer CLI and project integration updates ([#238](https://github.com/GOI17/alfred/issues/238)) ([5d573fd](https://github.com/GOI17/alfred/commit/5d573fd3c80fee1faa225499571bc6abaed8e8f1))

## [1.0.1](https://github.com/GOI17/alfred/compare/v1.0.0...v1.0.1) (2026-10-21)


### Bug Fixes

* **setup:** complete reviewed project harness activation ([#235](https://github.com/GOI17/alfred/issues/235)) ([bf95e84](https://github.com/GOI17/alfred/commit/bf95e84906b7c49f83117f00580102b0c5ddb445))

## [1.0.0](https://github.com/GOI17/alfred/compare/v0.7.4...v1.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **memory:** retire hosted service and require loopback ([#233](https://github.com/GOI17/alfred/issues/233))

### Features

* **memory:** retire hosted service and require loopback ([#233](https://github.com/GOI17/alfred/issues/233)) ([2f9b80c](https://github.com/GOI17/alfred/commit/2f9b80c2dd6b2b19b81436af518b624655c072ad))
* **skills:** manage versioned skills from chat and CLI ([#228](https://github.com/GOI17/alfred/issues/228)) ([901bed8](https://github.com/GOI17/alfred/commit/901bed8c4f478c765c8b835b88a8a33a0a331c34))


### Bug Fixes

* **setup:** avoid blocking terminal color queries ([#226](https://github.com/GOI17/alfred/issues/226)) ([b1d4505](https://github.com/GOI17/alfred/commit/b1d450549f9007133ac39c9af14f06e69d84783b))

## [0.7.4](https://github.com/GOI17/alfred/compare/v0.7.3...v0.7.4) (2026-10-18)


### Features

* **setup:** adopt Wave's Go terminal interface ([#223](https://github.com/GOI17/alfred/issues/223)) ([e28a262](https://github.com/GOI17/alfred/commit/e28a26219b324ff2f8da81556ace250303ba74f1))

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
