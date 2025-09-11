-- This file focuses on lsp related functions
-- This is the third iteration of my lsp setup in neovim
-- It is quite amazing that with nvim v0.11.0, lsp has became much easier to setup
return {
	-- A data repository, that stores all the config data for nvim lsp to start with
	{
		"neovim/nvim-lspconfig"
	},
	-- Make sure my source code is formatted as intended
	-- nvim natively support formatting, see the repo's features for why conform is a better choice
	{
		"stevearc/conform.nvim",
		config = function()
			require("conform").setup({
				formatters_by_ft = {
					-- Conform will run the first available formatter
					javascript = { "prettierd", "prettier" },
					typescript = { "prettierd", "prettier" },
					jsx = { "prettierd", "prettier" },
					tsx = { "prettierd", "prettier" },
					go = { "gofmt" },
					tf = { "terraform_fmt" },
					rust = { "rustfmt" },
					zsh = { "beautysh" },
					lua = { "stylua" },
					sql = { "pgformatter" },
					python = { "black" },
					html = { "htmlbeautifier" },
                    elixir = { "mix" },
				},
			})
			vim.keymap.set(
				{ "n", "v" },
				"<leader>f",
				"<cmd>lua require('conform').format()<cr>",
				{ desc = "Format code" }
			)
		end,
	},
    -- Better UI for rename
	{
		"smjonas/inc-rename.nvim",
		config = function()
            require("inc_rename").setup()
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
        end
	},
}
