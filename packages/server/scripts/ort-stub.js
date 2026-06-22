// パッケージ版(単一バイナリ)には onnxruntime-node(ネイティブアドオン)を同梱しない。
// silero.ts は `await import('onnxruntime-node')` で動的ロードするため、
// このスタブが評価された時点で例外 → selectVadProvider が silencedetect にフォールバックする。
// (通常はパッケージ版で VEH_DISABLE_SILERO=1 のため、ここには到達しない)
throw new Error('onnxruntime-node is not bundled in the packaged build (falling back to silencedetect VAD)');
