{
  description = "video-edit-helper の開発環境(ffmpeg / whisper-cpp などのネイティブ依存を nix で固定)";

  # home-manager と同じ nixpkgs リビジョンに固定し、バージョンのズレを防ぐ
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/fdc7b8f7b30fdbedec91b71ed82f36e1637483ed";

  outputs = { self, nixpkgs }:
    let
      # Linux / macOS(Intel・Apple Silicon)をサポート
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # Node / pnpm は mise(.tool-versions)で管理するためここには入れない。
          # 映像・音声処理のネイティブツールだけを nix で固定する。
          packages = [
            pkgs.ffmpeg # メタデータ抽出・サムネ・プロキシ・音声抽出(libx264/x265 入り)
            pkgs.whisper-cpp # 文字起こし(whisper-cli)
          ];

          # whisper モデルの既定パスは packages/server/models/ggml-small.bin。
          # whisper-cli はここで PATH に入るので server は WHISPER_PATH 既定値のまま動く。
          # 標準出力を汚さないよう stderr に出す(direnv / スクリプトの command 置換対策)
          shellHook = ''
            echo "veh devshell: $(ffmpeg -version | head -1 | cut -d' ' -f1-3), whisper-cli=$(command -v whisper-cli >/dev/null && echo ok || echo missing)" >&2
          '';
        };
      });
    };
}
