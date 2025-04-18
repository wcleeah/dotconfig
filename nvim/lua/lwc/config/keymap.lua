vim.g.mapleader = " "

vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

vim.keymap.set("n", "J", "mzJ`z")
vim.keymap.set("n", "<C-d>", "<C-d>zz")
vim.keymap.set("n", "<C-u>", "<C-u>zz")
vim.keymap.set("n", "n", "nzzzv")
vim.keymap.set("n", "N", "Nzzzv")
vim.keymap.set("n", "<leader>zig", "<cmd>LspRestart<cr>")

-- greatest remap ever
vim.keymap.set("x", "<leader>p", [["_dP]])

vim.keymap.set({"n", "v"}, "<leader>d", [["_d]])

-- This is going to get me cancelled
vim.keymap.set("i", "<C-c>", "<Esc>")

vim.keymap.set("n", "Q", "<nop>")

vim.keymap.set("n", "<C-k>", "<cmd>cnext<CR>zz")
vim.keymap.set("n", "<C-j>", "<cmd>cprev<CR>zz")
vim.keymap.set("n", "<leader>k", "<cmd>lnext<CR>zz")
vim.keymap.set("n", "<leader>j", "<cmd>lprev<CR>zz")

vim.keymap.set("n", "<leader>s", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]])
vim.keymap.set("n", "<leader>S", [[:%s/\<*<C-r><C-w>*\>/<C-r><C-w>/gI<Left><Left><Left>]])

vim.keymap.set({"n", "v"}, "<leader>wh", "<c-w>h")
vim.keymap.set({"n", "v"}, "<leader>wl", "<c-w>l")
vim.keymap.set({"n", "v"}, "<leader>wj", "<c-w>j")
vim.keymap.set({"n", "v"}, "<leader>wk", "<c-w>k")
vim.keymap.set({"n", "v"}, "<leader>wv", "<c-w>v")
vim.keymap.set({"n", "v"}, "<leader>wa", "<c-w>>")
vim.keymap.set({"n", "v"}, "<leader>wd", "<c-w><")

-- greatest remap ever
vim.keymap.set("x", "<leader>p", [["_dP]])

-- next greatest remap ever : asbjornHaland
vim.keymap.set({"n", "v"}, "<leader>y", [["+y]])
vim.keymap.set("n", "<leader>Y", [["+Y]])

vim.keymap.set('n', '<leader>xn', '<cmd>lua vim.diagnostic.goto_next()<CR>', { noremap = true, silent = true })
vim.keymap.set('n', '<leader>xp', '<cmd>lua vim.diagnostic.goto_prev()<CR>', { noremap = true, silent = true })

vim.keymap.set('n', '<leader>qn', '<cmd>cnext<CR>', { noremap = true, silent = true })
vim.keymap.set('n', '<leader>qp', '<cmd>cprev<CR>', { noremap = true, silent = true })
vim.keymap.set("n", "<C-n>", "<cmd>silent !tmux neww tmux-sessionizer<CR>")
vim.keymap.set("n", "<C-f>", "<cmd>silent !tmux neww tmux-session-switcher<CR>")
