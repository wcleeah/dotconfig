return {
	{
		"stevearc/oil.nvim",
		opts = {},
		dependencies = { { "nvim-tree/nvim-web-devicons", opts = {} } },
		config = function()
			require("oil").setup({
				skip_confirm_for_simple_edits = true,
				default_file_explorer = true,
				columns = {
					"icon",
					"mtime",
				},
				view_options = {
					show_hidden = true,
				},
				delete_to_trash = true,
			})
			vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory" })
			vim.keymap.set("n", "<leader>fs", "<CMD>Oil<CR>", { desc = "Open parent directory" })
		end,
	},
	{
		"MagicDuck/grug-far.nvim",
		config = function()
			-- optional setup call to override plugin options
			-- alternatively you can set options with vim.g.grug_far = { ... }
			require("grug-far").setup({
				-- maybe it's because it is using a split, i prefer normal mode more than insert mode
				startInInsertMode = false,
				-- i always start a split on the right side, vertically
				windowCreationCommand = "rightbelow vsplit",
				-- no ruin of the line intuition
				wrap = false,
			})
			vim.keymap.set("n", "<leader>far", "<cmd>GrugFar<cr>", { desc = "Find in grug far" })
		end,
	},
	{
		"ThePrimeagen/harpoon",
		branch = "harpoon2",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			local harpoon = require("harpoon")

			-- REQUIRED
			harpoon:setup()
			-- REQUIRED

			vim.keymap.set("n", "<leader>a", function()
				harpoon:list():add()
			end)
			vim.keymap.set("n", "<C-e>", function()
				harpoon.ui:toggle_quick_menu(harpoon:list())
			end)

			vim.keymap.set("n", "<C-h>", function()
				harpoon:list():select(1)
			end)
			vim.keymap.set("n", "<C-j>", function()
				harpoon:list():select(2)
			end)
			vim.keymap.set("n", "<C-k>", function()
				harpoon:list():select(3)
			end)
			vim.keymap.set("n", "<C-l>", function()
				harpoon:list():select(4)
			end)
		end,
	},
	{
		"mbbill/undotree",
		config = function()
			vim.keymap.set("n", "<leader>q", vim.cmd.UndotreeToggle)
			vim.g.undotree_SetFocusWhenToggle = 1
		end,
	},
	{
		"jemag/telescope-diff.nvim",
		dependencies = {
			{ "nvim-telescope/telescope.nvim" },
		},
		config = function()
			require("telescope").setup({
				defaults = {
					layout_strategy = "horizontal",
					layout_config = { prompt_position = "top" },
				},
			})
			require("telescope").load_extension("diff")
			vim.keymap.set("n", "<leader>fdd", function()
				require("telescope").extensions.diff.diff_files({ hidden = true, no_ignore = true })
			end, { desc = "Compare 2 files" })
			vim.keymap.set("n", "<leader>fd", function()
				require("telescope").extensions.diff.diff_current({ hidden = true, no_ignore = true })
			end, { desc = "Compare file with current" })
		end,
	},
}
