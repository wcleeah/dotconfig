local lsps = {
	"lua_ls",
	"gopls",
	"ts_ls",
	"nextls", -- elixir
	"just", -- justfile
	"html",
	"emmet_language_server",
    "pyright",
}

vim.lsp.enable(lsps)
