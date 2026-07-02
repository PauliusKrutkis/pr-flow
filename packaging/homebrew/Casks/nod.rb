# Homebrew cask for Nod. Lives in the tap repo
# (github.com/PauliusKrutkis/homebrew-tap → Casks/nod.rb); the copy here is
# the template the release workflow renders with real version + sha256 values.
#
# Install:
#   brew tap pauliuskrutkis/tap
#   brew install --cask --no-quarantine nod
#
# (--no-quarantine because releases aren't Apple-notarized yet; the in-app
# updater keeps it current after the first install.)
cask "nod" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "REPLACE_ARM_SHA256",
         intel: "REPLACE_INTEL_SHA256"

  url "https://github.com/PauliusKrutkis/pr-flow/releases/download/v#{version}/Nod_#{version}_#{arch}.dmg"
  name "Nod"
  desc "Keyboard-first code review for GitHub and GitLab"
  homepage "https://github.com/PauliusKrutkis/pr-flow"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "Nod.app"

  zap trash: [
    "~/Library/Application Support/com.pauliuskrutkis.nod",
  ]
end
