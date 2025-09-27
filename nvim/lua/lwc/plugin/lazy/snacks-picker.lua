-- Picker for everthing
return {
	"folke/snacks.nvim",
	dependencies = { { "nvim-tree/nvim-web-devicons", opts = {} } },
	config = function()
		-- Get the organic snacks, for setting up later
		local Snacks = require("snacks")
		Snacks.setup({
			picker = {
				matcher = {
					frecency = true,
				},
				debug = {
					scores = true, -- show scores in the list
				},
			},
		})

		-- file formatter, used for when the result is a file (except for the buffer selector)
		local function custom_format(item, _)
			-- coz item does not come with the icon, but i want the icon
			-- so i used the nvim-web-devicons to retrieve the icon and hl group for the file type
			-- this is installed as a dependency of oil nvim
			local devicons = require("nvim-web-devicons")
			local icon, hl = "", ""
			if item.file then
				icon, hl = devicons.get_icon(item.file, nil, { default = true })
			end

			-- i copied this line from the snacks repo
			-- here https://github.com/folke/snacks.nvim/blob/bc0630e43be5699bb94dadc302c0d21615421d93/lua/snacks/picker/format.lua#L94
			-- item.file comes with the full path
			local dir, filename = item.file:match("^(.*)/(.+)$")

			-- returning a lua table
			return {
				{ icon or "", hl }, -- icon
				{ " ", virtual = true }, -- separator
				{ dir, "SnacksPickerDir" }, -- the directory
				{ "/", "SnacksPickerDir", virtual = true }, -- add the / to connect the file and the directory
				{ filename or item.file, "SnacksPickerList" }, -- the filename
			}
		end

		local matcher = {
			fuzzy = true, -- use fuzzy matching
			smartcase = true, -- use smartcase
			ignorecase = true, -- use ignorecase
			sort_empty = false, -- sort results when the search string is empty
			file_pos = true, -- support patterns like `file:line:col` and `file:line`
			frecency = true, -- frecency bonus
		}

		local function no_insert()
			vim.cmd.stopinsert()
		end

		-- Picker configuration

		-- Grep related pickers
		-- simple quick global search
		-- this does not search the ignored files
		-- for more complex and replace, use far
		vim.keymap.set("n", "<leader>csf", function()
			Snacks.picker.grep({
				format = custom_format,
				debug = {
					scores = true, -- show scores in the list
				},
				cmd = "rg",
				matcher = matcher,
			})
		end, { desc = "Grep" })

		-- search for the selected string or the word under the cursor
		-- this does not search the ignored files
		vim.keymap.set({ "n", "v" }, "<leader>css", function()
			Snacks.picker.grep_word({
				format = custom_format,
				debug = {
					scores = true, -- show scores in the list
				},
				cmd = "rg",
				on_show = no_insert,
				matcher = matcher,
			})
		end, { desc = "Grep" })

		-- File related pickers
		-- does not search ignored files
		vim.keymap.set("n", "<leader>cso", function()
			Snacks.picker.files({
				format = custom_format,
				hidden = true,
				follow = true,
				cmd = "rg",
				matcher = matcher,
			})
		end, { desc = "File Search (git files + untracked)" })

		-- search for all files
		vim.keymap.set("n", "<leader>csa", function()
			Snacks.picker.files({
				format = custom_format,
				hidden = true,
				follow = true,
				ignored = true,
				cmd = "rg",
				matcher = matcher,
			})
		end, { desc = "File Search (All)" })

		-- search for logs related files
		vim.keymap.set("n", "<leader>csl", function()
			Snacks.picker.files({
				format = custom_format,
				hidden = true,
				follow = true,
				ignored = true,
				cmd = "rg",
				matcher = matcher,
				dirs = { "log", "logs" },
			})
		end, { desc = "File Search (logs)" })

		-- Misc pickers
		-- buffer browser
		vim.keymap.set("n", "<leader>csb", function()
			Snacks.picker.buffers({
				nofile = true,
				-- i don't think i will type to search a buffer, so normal mode is better
				-- i can directly navigate
				on_show = no_insert,
				-- add action to close a buffer
				win = {
					input = {
						keys = {
							["d"] = "bufdelete",
						},
					},
					list = { keys = { ["d"] = "bufdelete" } },
				},
			})
		end, { desc = "Buffers" })

		-- command history browser
		vim.keymap.set("n", "<leader>csc", function()
			Snacks.picker.command_history({
				on_show = no_insert,
			})
		end, { desc = "Command History" })

		-- git branches
		vim.keymap.set("n", "<leader>csg", function()
			Snacks.picker.git_branches({})
		end, { desc = "Git Branches" })

		-- keymaps starts with my leader, which is space
		vim.keymap.set("n", "<leader>csk", function()
			Snacks.picker.keymaps({ pattern = "<Space>", matcher = {
                fuzzy = false
            }})
		end, { desc = "Keymaps" })

		-- there are a few highlight groups using the same color as my nvim background color, which is #000000
		-- changing them to a light grey
		vim.api.nvim_set_hl(0, "SnacksPickerDir", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerBufFlags", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerTotals", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerKeymapRhs", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerPathHidden", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerUnselected", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerPathIgnored", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerGitStatusIgnored", { fg = "#676767" })
		vim.api.nvim_set_hl(0, "SnacksPickerGitStatusUntracked", { fg = "#676767" })

		-- change the filename to be white, to highlight it
		vim.api.nvim_set_hl(0, "SnacksPickerList", { fg = "#ffffff" })

		-- change the selection highlight to be green, default it is using my color scehme visual mode color
		vim.api.nvim_set_hl(0, "SnacksPickerListCursorLine", { fg = "#000000", bg = "#7BD88F" })
		vim.api.nvim_set_hl(0, "SnacksPickerPreviewCursorLine", { fg = "#000000", bg = "#7BD88F" })

		-- the above highlight grouop changes overrides the keyword coloring in preview window
		-- making the matched word in the preview window more visible
		vim.api.nvim_set_hl(0, "SnacksPickerSearch", { bold = true, italic = true, underline = true })
	end,
}
