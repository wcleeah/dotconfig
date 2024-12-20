return {
	"mbbill/undotree",
	config = function() 
		vim.keymap.set('n', '<leader>q', vim.cmd.UndotreeToggle)
	end
}
