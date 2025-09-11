vim.api.nvim_create_autocmd("LspAttach", {
    callback = function()
        vim.notify("Lsp Attached")
    end
})

vim.api.nvim_create_autocmd("LspDetach", {
    callback = function()
        vim.notify("Lsp Detached")
    end
})

vim.diagnostic.config({
	virtual_text = true,
	signs = true,
	underline = true,
})

vim.lsp.config("lua_ls", {
	settings = {
		Lua = {
			diagnostics = {
				globals = { "bit", "vim", "it", "describe", "before_each", "after_each" },
			},
		},
	},
})

vim.lsp.config("nextls", {
	cmd = { "nextls", "--stdio" },
	init_options = {
		extensions = {
			credo = { enable = true },
		},
		experimental = {
			completions = { enable = true },
		},
	},
})
