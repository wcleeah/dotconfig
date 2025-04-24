return {
	"mbbill/undotree",
	config = function()
		vim.keymap.set('n', '<leader>q', vim.cmd.UndotreeToggle)
        vim.g.undotree_SetFocusWhenToggle = 1
	end
}
