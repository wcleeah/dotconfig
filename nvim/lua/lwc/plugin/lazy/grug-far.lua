return {
	"MagicDuck/grug-far.nvim",
	config = function()
		-- optional setup call to override plugin options
		-- alternatively you can set options with vim.g.grug_far = { ... }
		require("grug-far").setup({
            -- maybe it's because it is using a split, i prefer normal mode more than insert mode
			startInInsertMode = true,
            -- i always start a split on the right side, vertically
			windowCreationCommand = "rightbelow vsplit",
            -- no ruin of the line intuition
            wrap = true,
		})
		vim.keymap.set("n", "<leader>gsf", "<cmd>GrugFar<cr>", { desc = "Find in grug far" })
	end,
}
