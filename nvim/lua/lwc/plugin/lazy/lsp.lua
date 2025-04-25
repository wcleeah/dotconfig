return {
    {
        'VonHeikemen/lsp-zero.nvim',
        branch = 'v4.x',
        lazy = true,
        config = false,
    },
    {
        'williamboman/mason.nvim',
        lazy = false,
        config = true,
    },
    {
        "folke/trouble.nvim",
        lazy = false,
        opts = {}, -- for default options, refer to the configuration section for custom setup.
        cmd = "Trouble",
        keys = {
            {
                "<leader>xx",
                "<cmd>Trouble diagnostics toggle<cr>",
                desc = "Diagnostics (Trouble)",
            },
            {
                "<leader>xX",
                "<cmd>Trouble diagnostics toggle filter.buf=0<cr>",
                desc = "Buffer Diagnostics (Trouble)",
            },
            {
                "<leader>cs",
                "<cmd>Trouble symbols toggle focus=false<cr>",
                desc = "Symbols (Trouble)",
            },
            {
                "<leader>xL",
                "<cmd>Trouble loclist toggle<cr>",
                desc = "Location List (Trouble)",
            },
            {
                "<leader>xQ",
                "<cmd>Trouble qflist toggle<cr>",
                desc = "Quickfix List (Trouble)",
            },
        },
    },
    {
        'hrsh7th/nvim-cmp',
        dependencies = {
            'brenoprata10/nvim-highlight-colors'
        },
        event = 'InsertEnter',
        config = function()
            local cmp = require('cmp')

            cmp.setup({
                formatting = {
                    format = require("nvim-highlight-colors").format,
                },
                window = {
                    completion = cmp.config.window.bordered({ border = "rounded" }),
                    documentation = cmp.config.window.bordered({ border = "rounded" }),
                },
                completion = { completeopt = "menu,menuone,noinsert" },
                sources = {
                    { name = 'nvim_lsp' },
                },
                mapping = cmp.mapping.preset.insert({
                    ['<CR>'] = cmp.mapping.confirm({ select = true }),
                    ['<C-f>'] = cmp.mapping.scroll_docs(4),
                    ['<C-b>'] = cmp.mapping.scroll_docs(-4),
                    ['<C-a>'] = cmp.mapping.complete(),
                })
            })
            cmp.setup.filetype({ "sql" }, {
                sources = {
                    { name = "vim-dadbod-completion" },
                    { name = "buffer" },
                },
            })
        end
    },
    {
        'stevearc/conform.nvim',
        opts = {},
        config = function()
            require("conform").setup({
                formatters_by_ft = {
                    -- Conform will run the first available formatter
                    javascript = { "biome", "prettierd", "prettier", stop_after_first = true },
                    typescript = { "biome", "prettierd", "prettier", stop_after_first = true },
                    go = { "gofmt" },
                    tf = { "terraform_fmt" },
                    rust = { "rustfmt" },
                    zsh = { "beautysh" },
                },
            })
            vim.keymap.set("n", "<leader>f", "<cmd>lua require('conform').format()<cr>", { desc = "Format code" })
            vim.keymap.set("v", "<leader>f", "<cmd>lua require('conform').format()<cr>", { desc = "Format code" })
        end
    },
    {
        'neovim/nvim-lspconfig',
        cmd = { 'LspInfo', 'LspInstall', 'LspStart' },
        event = { 'BufReadPre', 'BufNewFile' },
        dependencies = {
            { 'hrsh7th/cmp-nvim-lsp' },
            { 'williamboman/mason.nvim' },
            { 'williamboman/mason-lspconfig.nvim' },
            { 'j-hui/fidget.nvim' }
        },
        config = function()
            local lsp_zero = require('lsp-zero')
            local rename = function()
                vim.lsp.buf.rename()
                vim.cmd('silent! wa')
            end

            -- lsp_attach is where you enable features that only work
            -- if there is a language server active in the file
            local lsp_attach = function(client, bufnr)
                local opts = { buffer = bufnr }

                vim.keymap.set('n', '<leader>lh', '<cmd>lua vim.lsp.buf.hover()<cr>', opts)
                vim.keymap.set('n', '<leader>ld', '<cmd>lua vim.lsp.buf.definition()<cr>', opts)
                vim.keymap.set('n', '<leader>lr', '<cmd>lua vim.lsp.buf.references()<cr>', opts)
                vim.keymap.set('n', '<leader>ls', '<cmd>lua vim.lsp.buf.signature_help()<cr>', opts)
                vim.keymap.set('n', '<leader>lcn', rename, opts)
                vim.keymap.set('n', '<leader>le', '<cmd>lua vim.diagnostic.open_float()<cr>', opts)
                vim.keymap.set("n", "<leader>ca", '<cmd>lua vim.lsp.buf.code_action()<cr>', opts)
                vim.keymap.set('n', '<leader>xn', '<cmd>lua vim.diagnostic.goto_next()<CR>', { noremap = true, silent = true })
                vim.keymap.set('n', '<leader>xp', '<cmd>lua vim.diagnostic.goto_prev()<CR>', { noremap = true, silent = true })

            end

            lsp_zero.extend_lspconfig({
                sign_text = true,
                lsp_attach = lsp_attach,
                capabilities = require('cmp_nvim_lsp').default_capabilities()
            })
            require('mason-lspconfig').setup({
                ensure_installed = {},
                handlers = {
                    -- this first function is the "default handler"
                    -- it applies to every language server without a "custom handler"
                    function(server_name)
                        require('lspconfig')[server_name].setup({
                            on_attach = function(client, bufnr)
                                vim.diagnostic.config({
                                    virtual_text = true,
                                    signs = true,
                                    underline = true,
                                })
                            end,
                        })
                    end,
                    ["lua_ls"] = function()
                        local lspconfig = require("lspconfig")
                        lspconfig.lua_ls.setup {
                            settings = {
                                Lua = {
                                    runtime = { version = "Lua 5.1" },
                                    diagnostics = {
                                        globals = { "bit", "vim", "it", "describe", "before_each", "after_each" },
                                    }
                                }
                            }
                        }
                    end,
                }
            })
        end
    }
}
