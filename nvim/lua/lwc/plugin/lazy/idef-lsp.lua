return {
	{
		"folke/trouble.nvim",
		opts = {
			auto_close = true,
			focus = true,
		},
		cmd = "Trouble",
		keys = {
			{
				"<leader>xx",
				"<cmd>Trouble diagnostics toggle<cr>",
				desc = "Diagnostics (Trouble)",
			},
			{
				"<leader>xl",
				"<cmd>Trouble diagnostics toggle filter.buf=0<cr>",
				desc = "Buffer Diagnostics (Trouble)",
			},
		},
	},
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
	{
		"williamboman/mason.nvim",
		lazy = false,
		dependencies = {
			{ "williamboman/mason-lspconfig.nvim" },
			{ "neovim/nvim-lspconfig" },
		},
		config = function()
			require("mason").setup()
			local rename = function()
				vim.lsp.buf.rename()
				vim.cmd("silent! wa")
			end

			-- lsp_attach is where you enable features that only work
			-- if there is a language server active in the file
            -- digital
			local lsp_attach = function(_, bufnr)
				vim.diagnostic.config({
					virtual_text = true,
					signs = true,
					underline = true,
				})
				local opts = { buffer = bufnr }

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

			require("mason-lspconfig").setup({
				ensure_installed = {},
				handlers = {
					function(server_name)
						vim.lsp.config(server_name, {
							on_attach = lsp_attach,
						})

						vim.lsp.enable(server_name)
					end,
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
						vim.lsp.enable("lua_ls")
					end,
				},
			})
		end,
	},
}
