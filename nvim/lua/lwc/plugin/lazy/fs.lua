return {
  'stevearc/oil.nvim',
  opts = {},
  dependencies = { { "nvim-tree/nvim-web-devicons", opts = {} } },
  config = function()
    require('oil').setup({
        skip_confirm_for_simple_edits = true,
        default_file_explorer = true,
        columns = {
            "icon",
            "mtime",
        },
        view_options = {
            show_hidden = true,
        }
    })
    vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory" })
    vim.keymap.set("n", "<leader>fs", "<CMD>Oil<CR>", { desc = "Open parent directory" })
  end
}
