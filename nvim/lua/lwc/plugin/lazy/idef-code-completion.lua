return {
	{
		"echasnovski/mini.surround",
		version = "*",
		config = function()
			require("mini.surround").setup({
				highlight_duration = 2000,

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
                n_lines = 200,
			})
		end,
	},
	{
		"supermaven-inc/supermaven-nvim",
		config = function()
			require("supermaven-nvim").setup({})
		end,
	},
	{
		"xzbdmw/colorful-menu.nvim",
		lazy = false,
		config = function()
			require("colorful-menu").setup()
			vim.api.nvim_set_hl(0, "BlinkCmpMenu", { bg = "#000000" })
		end,
	},
	{
		"saghen/blink.cmp",
		dependencies = {
			{ "xzbdmw/colorful-menu.nvim" },
		},
		version = "1.*",
		config = function()
			require("blink.cmp").setup({
				keymap = { preset = "enter" },
				sources = {
					default = { "lsp", "path", "buffer" },
				},
				fuzzy = { implementation = "prefer_rust" },
				cmdline = {
					enabled = false,
				},
				completion = {
					menu = {
						border = "rounded",
						scrollbar = false,
						draw = {
							-- We don't need label_description now because label and label_description are already
							-- combined together in label by colorful-menu.nvim.
							columns = { { "kind_icon" }, { "label", gap = 1 } },
							components = {
								label = {
									width = { fill = true, max = 60 },
									text = function(ctx)
										local highlights_info = require("colorful-menu").blink_highlights(ctx)
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
		end,
	},
}
