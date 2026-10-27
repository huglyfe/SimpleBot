# typed: strict
# frozen_string_literal: true

# Homebrew installs the published npm artifact and exposes its executable.
# It is not a second launcher: `brew services` runs the same `simplebot start`
# an operator runs by hand, against the same root layout.
#
# Prepared from an exact npm tarball with `pnpm package:brew <tarball>`.
# Publish that same tarball before distributing the formula.
class Simplebot < Formula
  desc "Self-hosted conversation engine with persistent context"
  homepage "https://github.com/huglyfe/simplebot"
  url "https://registry.npmjs.org/@huglyfe/simplebot/-/simplebot-0.1.0-alpha.1.tgz"
  version "0.1.0-alpha.1"
  sha256 "829e61efe45548db2aacea7bec53c47864419f45db3923965829748906e9528d"
  license "Apache-2.0"

  depends_on "python" => :build
  depends_on "node@24"
  depends_on "openssl@3"

  def install
    system "npm", "install", *std_npm_args
    paths = [formula_opt_bin("node@24"), formula_opt_bin("openssl@3"), ENV.fetch("PATH", nil)]
    bin.env_script_all_files libexec/"bin", PATH: paths.join(File::PATH_SEPARATOR)
  end

  service do
    run [opt_bin/"simplebot", "start"]
    keep_alive true
    log_path var/"log/simplebot.log"
    error_log_path var/"log/simplebot.log"
  end

  def caveats
    <<~EOS
      Conversations, bots, presets, and credentials live outside this
      formula, in:
        ~/Library/Application Support/SimpleBot   (macOS)
        ~/.local/share/simplebot                  (Linux)

      Uninstalling removes code only. `simplebot remove-data` is the one
      command that deletes that root, and it asks first.

      Start it, then pair a browser:
        simplebot start
        simplebot pair
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/simplebot version")
    system bin/"simplebot", "help"
    ENV["SIMPLEBOT_ROOT"] = testpath/"root"
    system bin/"simplebot", "init"
    assert_path_exists testpath/"root/config.json"
    assert_path_exists testpath/"root/bots"
    assert_empty (testpath/"root/bots").children
    assert_path_exists testpath/"root/presets/default.json"
  end
end
