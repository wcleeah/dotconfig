return   {
	"jemag/telescope-diff.nvim",
	dependencies = {
		{ "nvim-telescope/telescope.nvim" },
	},
	config = function()
		require("telescope").load_extension("diff")
		vim.keymap.set("n", "<leader>fdd", function()
			require("telescope").extensions.diff.diff_files({ hidden = true, no_ignore = true })
		end, { desc = "Compare 2 files" })
		vim.keymap.set("n", "<leader>fd", function()
			require("telescope").extensions.diff.diff_current({ hidden = true, no_ignore = true })
		end, { desc = "Compare file with current" })
	end
}
