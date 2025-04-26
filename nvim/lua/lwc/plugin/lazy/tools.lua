-- Misc tools plugin collection
return {
	-- A much better file explorer in neovim
	{
		"stevearc/oil.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		config = function()
			require("oil").setup({
                -- Skip the confirmation for create file, and same dir renaming
				skip_confirm_for_simple_edits = true,
                -- Use oil as the default file explorer instad of netrw
				default_file_explorer = true,
                -- Configure how each file/directory is displayed
				columns = {
					"icon",
					"mtime",
				},
                -- Show hidden files
				view_options = {
					show_hidden = true,
				},
                -- Delete the file to macos trash instead of permanently deleting
				delete_to_trash = true,
			})
			vim.keymap.set("n", "<leader>fs", "<CMD>Oil<CR>", { desc = "Open parent directory" })
		end,
	},
    -- Crazy find and replace plugin
	{
		"MagicDuck/grug-far.nvim",
		config = function()
			require("grug-far").setup({
				-- maybe it's because it is using a split, i prefer normal mode more than insert mode
				startInInsertMode = false,
				-- i always start a split on the right side, vertically
				windowCreationCommand = "rightbelow vsplit",
				-- no ruin of the line navigating intuition
				wrap = false,
			})
			vim.keymap.set("n", "<leader>far", "<cmd>GrugFar<cr>", { desc = "Find in grug far" })
		end,
	},
    -- Navigation bookmark 
	{
		"ThePrimeagen/harpoon",
		branch = "harpoon2",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			local harpoon = require("harpoon")

			harpoon:setup()

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
    -- Show the undo history in a tree format
	{
		"mbbill/undotree",
		config = function()
			vim.keymap.set("n", "<leader>q", vim.cmd.UndotreeToggle)
            -- This is to change a weird and annoying behavior of undotree
            -- If i have a split window, and i toggle undotree on the right side, the undotree buffer will be on the leftmost prompt_position 
            -- That means i need to first switch to the left split, then switch to the undotree buffer 
            -- So undotree will show the history of the left split, instead of the right split
            -- Immediately focusing the undotree buffer will solve this problem
            -- Also if i toggle undotree i probably want to focus the undotree buffer to navigate the history
			vim.g.undotree_SetFocusWhenToggle = 1
		end,
	},
    -- The best differ i have ever used, not only in neovim
    -- Uses telescope to select files
    -- And i can also edit the diff buffer, to get a better result
    -- For example, if i have two json files, one of them is wrapped in an array (thanks drizzle insert function)
    -- I can directly edit the diff buffer to remove the wrapping array, after that i can actually see the difference
	{
		"jemag/telescope-diff.nvim",
		dependencies = {
            -- The plugin uses telescope to select files
			{ "nvim-telescope/telescope.nvim" },
		},
		config = function()
            -- I switched to use snacks picker instead of telescope
            -- But to use this plugin, i still need to configure telescope
			require("telescope").setup({
				defaults = {
					layout_strategy = "horizontal",
                    -- Make the input box on the top of the popup window
					layout_config = { prompt_position = "top" },
				},
			})
			require("telescope").load_extension("diff")
			vim.keymap.set("n", "<leader>fdd", function()
				require("telescope").extensions.diff.diff_files({ hidden = true, no_ignore = true })
			end, { desc = "Compare 2 files" })
		end,
	},
}
