-- This file focuses on lsp related functions
-- This is the second iteration of my lsp setup in neovim
-- It is quite amazing that with nvim v0.11.0, lsp has became much easier to setup 
return {
    -- A tool to show diagnostics in a much better way
    -- It can also show diagnostics from all the files in the project
	{
		"folke/trouble.nvim",
		opts = {
            -- Closing the split after all diagnostics are fixed
			auto_close = true,
            -- Focus the split after i open it
			focus = true,
		},
		cmd = "Trouble",
		keys = {
            -- Trigger the trouble window for all diagnostics across all files
			{
				"<leader>xx",
				"<cmd>Trouble diagnostics toggle<cr>",
				desc = "Diagnostics (Trouble)",
			},
            -- Trigger the trouble window for diagnostics in the current buffer
			{
				"<leader>xl",
				"<cmd>Trouble diagnostics toggle filter.buf=0<cr>",
				desc = "Buffer Diagnostics (Trouble)",
			},
		},
	},
    -- Make sure my source code is formatted as intended
	{
		"stevearc/conform.nvim",
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
					lua = { "stylua" },
				},
			})
			vim.keymap.set(
				{ "n", "v" },
				"<leader>f",
				"<cmd>lua require('conform').format()<cr>",
				{ desc = "Format code" }
			)
		end,
	},
    -- Mason is a lsp installer for neovim
    -- And by using mason-lspconfig and nvim-lspconfig, i can setup lsp with the native neovim lsp api (added in nvim v0.11.0)
	{
		"williamboman/mason.nvim",
		lazy = false,
		dependencies = {
			{ "williamboman/mason-lspconfig.nvim" },
			{ "neovim/nvim-lspconfig" },
		},
		config = function()
			require("mason").setup()

            -- Write all files after renaming
			local rename = function()
				vim.lsp.buf.rename()
				vim.cmd("silent! wa")
			end

			-- lsp_attach is where you enable features that only work
			-- if there is a language server active in the file
			local lsp_attach = function(_, bufnr)
                -- Allow the lsp to update the buffer with signs
				vim.diagnostic.config({
					virtual_text = true,
					signs = true,
					underline = true,
				})
				local opts = { buffer = bufnr }

                -- Keymaps for lsp actions
				vim.keymap.set("n", "<leader>lh", "<cmd>lua vim.lsp.buf.hover()<cr>", opts)
				vim.keymap.set("n", "<leader>ld", "<cmd>lua vim.lsp.buf.definition()<cr>", opts)
				vim.keymap.set("n", "<leader>lr", "<cmd>lua vim.lsp.buf.references()<cr>", opts)
				vim.keymap.set("n", "<leader>ls", "<cmd>lua vim.lsp.buf.signature_help()<cr>", opts)
				vim.keymap.set("n", "<leader>lcn", rename, opts)
				vim.keymap.set("n", "<leader>le", "<cmd>lua vim.diagnostic.open_float()<cr>", opts)
				vim.keymap.set("n", "<leader>la", "<cmd>lua vim.lsp.buf.code_action()<cr>", opts)
				vim.keymap.set(
					"n",
					"<leader>xn",
					"<cmd>lua vim.diagnostic.goto_next()<CR>",
					{ noremap = true, silent = true }
				)
				vim.keymap.set(
					"n",
					"<leader>xp",
					"<cmd>lua vim.diagnostic.goto_prev()<CR>",
					{ noremap = true, silent = true }
				)
			end

            -- Here we use mason-lspconfig to setup lsp
            -- It will automatically retrieve all of my installed lsp servers, and allow me to setup each of them
			require("mason-lspconfig").setup({
				ensure_installed = {},
				handlers = {
                    -- Catch all configurations for lsp servers that does not have a specific handler
					function(server_name)
						vim.lsp.config(server_name, {
							on_attach = lsp_attach,
						})

                        -- The lsp server will only be launched when i open the file
                        -- This line is just to enable the lsp server to be launched (in my understanding)
						vim.lsp.enable(server_name)
					end,
                    -- Specific configuration for lua_ls
                    -- It makes the lsp to ignore the global variables
					["lua_ls"] = function()
						vim.lsp.config("lua_ls", {
							on_attach = lsp_attach,
							settings = {
								Lua = {
									runtime = { version = "Lua 5.1" },
									diagnostics = {
										globals = { "bit", "vim", "it", "describe", "before_each", "after_each" },
									},
								},
							},
						})

                        -- The lsp server will only be launched when i open the file
                        -- This line is just to enable the lsp server to be launched (in my understanding)
						vim.lsp.enable("lua_ls")
					end,
				},
			})
		end,
	},
}
