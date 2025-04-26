-- Neovim UI plugin related 
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
                    -- Show notification when a macro recording is started
                    {
                        view = "notify",
                        filter = {
                            event = "msg_showmode",
                            find = "recording",
                        },
                    },
                    -- Skip buffer write notification
                    {
                        filter = {
                            event = "msg_show",
                            find = "written",
                        },
                        opts = { skip = true },
                    },
                    -- A weird bug of noice, when using lsp's code action, it will prompt the user to select an action
                    -- However, in noice the prompt uses notification window, and the notification is not shown coz it is getting blocked by the prompt
                    -- So to solve this problem, i use a split window to show the code action instead
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
    -- The bottom status line
    {
        'nvim-lualine/lualine.nvim',
        dependencies = { 'nvim-tree/nvim-web-devicons' },
        config = function()
            require('lualine').setup {
                sections = {
                    -- Show the current buffer file name
                    lualine_c = {{ 'filename', path = 2 }},
                    -- Show the current mode
                    -- Visual, Insert, Recording, etc
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
    -- Beloved colorscheme 
    {
        "loctvl842/monokai-pro.nvim",
        config = function()
            require("monokai-pro").setup({
                -- Override the background color to pure black
                overridePalette = function(_)
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
            vim.cmd([[highlight Visual guifg=#000000 guibg=#5ad4e6]])
        end
    },
}
