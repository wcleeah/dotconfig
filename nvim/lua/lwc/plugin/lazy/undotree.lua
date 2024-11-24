return {
	"mbbill/undotree",
	config = function() 
		vim.keymap.set('n', '<leader>q', vim.cmd.UndotreeToggle)
		vim.keymap.set('n', '<c-q>', vim.cmd.UndotreeToggle)
	end
}
