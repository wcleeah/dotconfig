return {
    {
        "folke/noice.nvim",
        event = "VeryLazy",
        dependencies = {
            "MunifTanjim/nui.nvim",
            "rcarriga/nvim-notify"
        },
        config = function()
            require("noice").setup({
                lsp = {
                    -- override markdown rendering so that **cmp** and other plugins use **Treesitter**
                    override = {
                        ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
                        ["vim.lsp.util.stylize_markdown"] = true,
                        ["cmp.entry.get_documentation"] = true, -- requires hrsh7th/nvim-cmp
                    },
                },
                -- you can enable a preset for easier configuration
                presets = {
                    bottom_search = false,        -- use a classic bottom cmdline for search
                    command_palette = true,       -- position the cmdline and popupmenu together
                    long_message_to_split = true, -- long messages will be sent to a split
                    inc_rename = false,           -- enables an input dialog for inc-rename.nvim
                    lsp_doc_border = false,       -- add a border to hover docs and signature help
                },
                routes = {
                    {
                        view = "notify",
                        filter = {
                            event = "msg_showmode",
                            find = "recording",
                        },
                    },
                    {
                        filter = {
                            event = "msg_show",
                            find = "written",
                        },
                        opts = { skip = true },
                    },
                    {
                        view = "split",
                        filter = {
                            event = "msg_show",
                            blocking = true,
                            find = "Code actions:",
                        },
                    },
                },
            })
            require("notify").setup({
                timeout = 50, -- time in milliseconds
            })
        end
    },
    {
        'nvim-lualine/lualine.nvim',
        dependencies = { 'nvim-tree/nvim-web-devicons' },
        config = function()
            require('lualine').setup {
                sections = {
                    lualine_c = {{ 'filename', path = 2 }},
                    lualine_x = {
                        {
                            require("noice").api.statusline.mode.get,
                            cond = require("noice").api.statusline.mode.has,
                            color = { fg = "#ff9e64" },
                        }
                    },
                },
                options = { theme = 'codedark' },
            }
        end
    },
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
