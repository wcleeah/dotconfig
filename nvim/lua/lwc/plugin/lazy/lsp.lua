-- This file focuses on lsp related functions
-- This is the third iteration of my lsp setup in neovim
-- It is quite amazing that with nvim v0.11.0, lsp has became much easier to setup
return {

	-- A data repository, that stores all the config data for nvim lsp to start with
	{
		"neovim/nvim-lspconfig",
	},
	-- Make sure my source code is formatted as intended
	-- nvim natively support formatting, see the repo's features for why conform is a better choice
	{
		"stevearc/conform.nvim",
		config = function()
			require("conform").setup({
				formatters_by_ft = {
					-- Conform will run the first available formatter
					javascript = { "biome", "prettierd", "prettier", stop_after_first = true },
					typescript = { "biome", "prettierd", "prettier", stop_after_first = true },
					html = { "prettierd", "prettier" },
					jsx = { "prettierd", "prettier" },
					tsx = { "prettierd", "prettier" },
					go = { "gofmt" },
					tf = { "terraform_fmt" },
					rust = { "rustfmt" },
					zsh = { "beautysh" },
					lua = { "stylua" },
					sql = { "pgformatter" },
					python = { "black" },
					elixir = { "mix" },
					json = { "biome" },
				},
			})
			vim.keymap.set({ "n", "v" }, "<leader>f", function()
				require("conform").format({}, function(err, did_edit)
					if err then
						vim.notify("Format Error: " .. err, "error")
					elseif did_edit then
						vim.notify("File formatted, edited")
					else
						vim.notify("File formatted, no edit")
					end
				end)
			end, { desc = "Format code" })
		end,
	},
	-- Better UI for rename
	{
		"smjonas/inc-rename.nvim",
		config = function()
			require("inc_rename").setup({})
			vim.keymap.set("n", "<leader>lcn", function()
				return ":IncRename " .. vim.fn.expand("<cword>")
			end, { expr = true })
		end,
	},
	-- LSP server installer for neovim
	{
		"williamboman/mason.nvim",
		config = function()
			require("mason").setup()
		end,
	},
}
