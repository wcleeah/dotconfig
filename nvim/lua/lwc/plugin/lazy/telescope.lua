return {
    'nvim-telescope/telescope.nvim',
    tag = '0.1.8',
    dependencies = { 'nvim-lua/plenary.nvim', 'nvim-tree/nvim-web-devicons' },
    config = function()
        local builtin = require('telescope.builtin')
        vim.keymap.set('n', '<leader>csf', builtin.live_grep, { desc = 'Telescope live grep' })
        vim.keymap.set('n', '<leader>csg', builtin.grep_string, { desc = 'Telescope live grep' })
        vim.keymap.set('n', '<leader>cso', builtin.find_files, { desc = 'Telescope find files' })
        vim.keymap.set('n', '<leader>csa', function() builtin.find_files({ hidden = true, no_ignore = true }) end, { desc = 'Telescope find files' })
        vim.keymap.set('n', '<leader>bls', builtin.buffers, {})
        vim.keymap.set('n', '<leader>ba', '<CMD>bnext<CR>', {})
        vim.keymap.set('n', '<leader>bl', '<CMD>bprevious<CR>', {})

        require('telescope').setup {
            defaults = {
                layout_strategy = 'horizontal',
                layout_config = { prompt_position = 'top' },
            },
        }
    end
}
