-- This file focuses on syntax highlighting related functions
-- So basically this file is about how to display and highlight the source code
return {
    -- Syntax highlighting using treesitter api
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		dependencies = { "HiPhish/nvim-ts-rainbow2" },
		opts = function(_, opts)
			opts.rainbow = {
				enable = true,
				query = "rainbow-parens",
				strategy = require("ts-rainbow").strategy.global,
			}
		end,
		config = function()
			require("nvim-treesitter.configs").setup({
				-- A list of parser names, or "all" (the listed parsers MUST always be installed)
				ensure_installed = {
					"lua",
					"vim",
					"typescript",
					"javascript",
					"go",
					"vimdoc",
					"bash",
					"json",
					"html",
					"css",
					"tsx",
				},

				sync_install = false,

				-- Automatically install missing parsers when entering buffer
				-- Recommendation: set to false if you don't have `tree-sitter` CLI installed locally
				auto_install = true,

				highlight = {
					enable = true,

					-- Setting this to true will run `:h syntax` and tree-sitter at the same time.
					-- Set this to `true` if you depend on 'syntax' being enabled (like for indentation).
					-- Using this option may slow down your editor, and you may see some duplicate highlights.
					-- Instead of true it can also be a list of languages
					additional_vim_regex_highlighting = false,
				},
			})
		end,
	},
    -- This keeps the context of a block scope
    -- Fix the closest start of a block at the top of the screen
	{
		"nvim-treesitter/nvim-treesitter-context",
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
		},
		config = function()
			require("treesitter-context").setup({
				enable = true,
			})
			vim.keymap.set("n", "<leader>b", function()
				require("treesitter-context").go_to_context(vim.v.count1)
			end, { silent = true })
		end,
	},
    -- rainbow brackets
	{
		"HiPhish/rainbow-delimiters.nvim",
	},
    -- Highlight hex code, like this
    -- #ffffff
    -- #aaaaaa
    -- #333333
	{
		"brenoprata10/nvim-highlight-colors",
		config = function()
			require("nvim-highlight-colors").setup({})
		end,
	},
}
