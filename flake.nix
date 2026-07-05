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

          # shellHook は空にしている。以前は ffmpeg / whisper-cli の存在確認メッセージを
          # 出していたが、Zed(WSL) 起動時の fish 経路で shellHook の値が fish コードとして
          # eval される事象が発生し、devshell 突入時にクラッシュしていた。
          # 診断が必要なら手動で `ffmpeg -version` / `command -v whisper-cli` を叩けば良い。
          shellHook = "";
        };
      });
    };
}
