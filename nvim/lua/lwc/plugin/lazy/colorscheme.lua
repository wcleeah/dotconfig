return {
    {
        "loctvl842/monokai-pro.nvim",
        config = function()
            require("monokai-pro").setup({
                overridePalette = function(filter)
                    return {
                        background = "#000000",
                    }
                end,
                filter = "spectrum",
                devicons = true,
                background_clear = {
                    "float_win",
                    "telescope",
                    "renamer",
                    "notify",
                    "nvim-tree"
                }
            })
            vim.cmd([[colorscheme monokai-pro]])
            vim.cmd [[highlight Visual guifg=#000000 guibg=#5ad4e6]]
        end
    },
    {
        "HiPhish/rainbow-delimiters.nvim"
    },
    {
        'brenoprata10/nvim-highlight-colors',
        config = function()
            vim.opt.termguicolors = true
            require('nvim-highlight-colors').setup({})
        end
    }
}
