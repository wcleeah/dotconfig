local lsps = {
	"lua_ls",
	"gopls",
	"ts_ls",
	"nextls", -- elixir
	"just", -- justfile
}

vim.lsp.enable(lsps)
