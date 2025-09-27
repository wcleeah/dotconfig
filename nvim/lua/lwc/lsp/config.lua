-- add notification when a lsp server is attached or detached
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function()
		vim.notify("Lsp Attached")
	end,
})
vim.api.nvim_create_autocmd("LspDetach", {
	callback = function()
		vim.notify("Lsp Detached")
	end,
})

-- dianostic information ui configuration
vim.diagnostic.config({
	virtual_text = true,
	signs = true,
	underline = true,
})

-- specific LSP configuration

-- Lua
-- inject nvim types and vim global variables to the lsp
-- we get auto completion on vim related options, and no more warning weeee
vim.lsp.config("lua_ls", {
	settings = {
		Lua = {
			workspace = {
				library = vim.api.nvim_get_runtime_file("", true),
			},
		},
	},
})

-- Elixir (sucks)
-- 1. all of the mainstream lsp (lexical, elixir-ls) does not compile to a executable, which means nvim cannot run that
-- 2. even if i use nextls, i still need to pass a flag to let it know it is running in stdio mode, and i need specify bunch of options
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

-- JS / TS
-- Somehow the maintainer decide all JS/TS project will have a lock file, fuck you
vim.lsp.config("ts_ls", {
	root_dir = function(bufnr, on_dir)
		local project_root = vim.fs.root(bufnr, ".git") or vim.fn.getcwd()

		on_dir(project_root)
	end,
	init_options = {
		preferences = {
			importModuleSpecifierEnding = "js",
			includeCompletionsForModuleExports = true,
			includeCompletionsForImportStatements = true,
		},
	},
})
