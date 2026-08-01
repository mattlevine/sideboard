# frozen_string_literal: true

# Homebrew formula stub for the Sideboard CLI.
# Published via a tap (e.g. sideboard-ai/homebrew-tap) with bun-compiled binaries.
#
# Usage (once the tap ships):
#   brew install sideboard-ai/tap/sideboard

class Sideboard < Formula
  desc "Agent-agnostic orchestration layer over git worktrees"
  homepage "https://github.com/sideboard-ai/sideboard"
  version "0.1.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/sideboard-ai/sideboard/releases/download/v#{version}/sideboard-darwin-arm64.tar.gz"
      # sha256 "REPLACE_WITH_RELEASE_SHA"
    end
    on_intel do
      url "https://github.com/sideboard-ai/sideboard/releases/download/v#{version}/sideboard-darwin-x64.tar.gz"
      # sha256 "REPLACE_WITH_RELEASE_SHA"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/sideboard-ai/sideboard/releases/download/v#{version}/sideboard-linux-arm64.tar.gz"
      # sha256 "REPLACE_WITH_RELEASE_SHA"
    end
    on_intel do
      url "https://github.com/sideboard-ai/sideboard/releases/download/v#{version}/sideboard-linux-x64.tar.gz"
      # sha256 "REPLACE_WITH_RELEASE_SHA"
    end
  end

  def install
    bin.install "sideboard"
    bin.install_symlink "sideboard" => "side"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sideboard --version")
  end
end
