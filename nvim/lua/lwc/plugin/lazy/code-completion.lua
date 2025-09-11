-- This file focuses on any code completion functions provided by plugin
return {
	-- It can change the surround symbol fairly easily
	-- say i have "abc", i can change it to `abc` with a keymap
	{
		"echasnovski/mini.surround",
		version = "*",
		config = function()
			require("mini.surround").setup({
				highlight_duration = 2000, -- my reaction time is too slow, need a longer timespan

				mappings = {
					highlight = "<leader>sf", -- Highlight surrounding
					replace = "<leader>sr", -- Replace surrounding
					-- Below are the unused one, "" is how it disable the mapping
					add = "", -- Add surrounding in Normal and Visual modes
					delete = "", -- Delete surrounding
					find = "", -- Find surrounding (to the right)
					find_left = "", -- Find surrounding (to the left)
					update_n_lines = "", -- Update `n_lines`
					suffix_last = "", -- Suffix to search with "prev" method
					suffix_next = "", -- Suffix to search with "next" method
				},
				n_lines = 200, -- I have to deal with if clauses that are thousands lines long
			})
		end,
	},
	-- It provides the code completion popup with much more information, like function sign, type etc.
	-- The only downside is that it always override my hl group setting.
	{
		"xzbdmw/colorful-menu.nvim",
		lazy = false,
		config = function()
			require("colorful-menu").setup()
            -- I have to set the hl group everytime blnk / colorful-menu is required
			vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#000000" })
		end,
	},
	{
		"saghen/blink.cmp",
		dependencies = {
			{ "xzbdmw/colorful-menu.nvim" },
		},
        -- I think i can only use the rust version if i mark the version
		version = "1.*",
		config = function()
			require("blink.cmp").setup({
				keymap = { preset = "default" },
				sources = {
					default = { "lsp", "path" },
				},
				fuzzy = { implementation = "prefer_rust" },
                -- The popup menu is so ugly, i don't want to use it in noice's command palette 
                -- So i just disable blink's command palette completion capabilities
				cmdline = {
					enabled = false,
				},
				completion = {
                    -- My attempt to make the popup menu prettier
					menu = {
						border = "rounded",
						scrollbar = false,
						draw = {
                            -- Configuring the menu with colorful-menu.nvim
							columns = { { "kind_icon" }, { "label", gap = 1 } },
							components = {
								label = {
									width = { fill = true, max = 60 },
									text = function(ctx)
										local highlights_info = require("colorful-menu").blink_highlights(ctx)
										-- I have to set the hl group everytime blnk / colorful-menu is required
										vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#000000" })
										if highlights_info ~= nil then
											-- Or you want to add more item to label
											return highlights_info.label
										else
											return ctx.label
										end
									end,
									highlight = function(ctx)
										local highlights = {}
										local highlights_info = require("colorful-menu").blink_highlights(ctx)
										if highlights_info ~= nil then
											highlights = highlights_info.highlights
										end
										for _, idx in ipairs(ctx.label_matched_indices) do
											table.insert(highlights, { idx, idx + 1, group = "BlinkCmpLabelMatch" })
										end
										-- I have to set the hl group everytime blnk / colorful-menu is required
										vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#000000" })
										-- Do something else
										return highlights
									end,
								},
							},
						},
					},
					documentation = { auto_show = true },
				},
			})
			-- I have to set the hl group everytime blnk / colorful-menu is required
			vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#000000" })
		end,
	},
}
