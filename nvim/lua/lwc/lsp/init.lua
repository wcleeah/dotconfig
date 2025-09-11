-- config.lua must be loaded beforer enable.lua
-- some lsp require specific configuration like elixir / lua
-- so before enabling them, config must be done first
require("lwc.lsp.config")
require("lwc.lsp.enable")
