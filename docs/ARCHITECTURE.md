# Source release notes

This public preview extracts the existing Northstar learning-state engine and adds a standalone demo with original lessons. See source-provenance.json for the exact snapshot hashes.

The browser loads core scripts in this order: storage, review engine, curriculum, speaking progress, results, rewards. These files intentionally keep their original global interfaces. The demo calls prepareAnimationWords for course selection, LearningResults.record for each check, applyVocabularyAnswer for final progress, SpeakingProgress.defer for voluntary deferral and finalizeDailyRewards for idempotent completion.

The demo commits question evidence and resume position through atomicUpdate, then reloads the saved state. Its controls are disabled while saving. The original atomicUpdate lock is limited to one page; the demo requires Web Locks to prevent two public-preview tabs from independently writing at the same time. Browsers without Web Locks show an unsupported-browser message. No multi-device synchronization is provided.

Speech synthesis is a demonstration input provider, not assessment. A listen check requires successful speech completion in the current screen. Vocabulary completion and speech assessment are separate facts. The default demo neither imports the Tencent adapter nor touches the microphone.

The static server serves only a source-controlled file whitelist. The API namespace, private dotfiles, traversal paths and original application files are unavailable. It binds to loopback and is a development/demo server, not a hosted production service.
