-- Set the leader key to be space
vim.g.mapleader = " "

-- Move the selected line up and down, with correct indenting
-- config explained here https://www.perplexity.ai/search/vim-keymap-set-n-leader-xp-cmd-YM86TAndRKKXb5Q_V4a.PA#3
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

-- Normal J but keep the cursor position
vim.keymap.set("n", "J", "mzJ`z")
vim.keymap.set("n", "Ki", "mzi<CR><Esc>`z")
vim.keymap.set("n", "K", "mza<CR><Esc>`z")

-- Normal page down / up but keep the cursor in the middle of the page
vim.keymap.set("n", "<C-d>", "<C-d>zz")
vim.keymap.set("n", "<C-u>", "<C-u>zz")

-- Normal search next / prev but keep the cursor in the middle of the page
vim.keymap.set("n", "n", "nzzzv")
vim.keymap.set("n", "N", "Nzzzv")

-- Paste without overriding the register
vim.keymap.set("x", "<leader>p", [["_dP]])

-- Remap ctrl-c to esc
vim.keymap.set("i", "<C-c>", "<Esc>")

vim.keymap.set("n", "Q", "<nop>")

-- Navigating quickfix list and location list, but keep the cursor in the middle of the page
vim.keymap.set("n", "<leader>qn", "<cmd>cnext<CR>zz")
vim.keymap.set("n", "<leader>qp", "<cmd>cprev<CR>zz")
vim.keymap.set("n", "<leader>k", "<cmd>lnext<CR>zz")
vim.keymap.set("n", "<leader>j", "<cmd>lprev<CR>zz")

-- Quick search and replace the selected word / the characters selected in visual mode
vim.keymap.set("n", "<leader>s", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]])
vim.keymap.set("v", "<leader>s", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]])

-- splits and window management
vim.keymap.set({"n", "v"}, "<leader>wh", "<c-w>h")
vim.keymap.set({"n", "v"}, "<leader>wl", "<c-w>l")
vim.keymap.set({"n", "v"}, "<leader>wj", "<c-w>j")
vim.keymap.set({"n", "v"}, "<leader>wk", "<c-w>k")
vim.keymap.set({"n", "v"}, "<leader>wv", "<c-w>v")
vim.keymap.set({"n", "v"}, "<leader>wa", "<c-w>>")
vim.keymap.set({"n", "v"}, "<leader>wd", "<c-w><")

-- Copy to system clipboard
vim.keymap.set({"n", "v"}, "<leader>y", [["+y]])

-- Call tmux to switch tmux session
vim.keymap.set("n", "<C-n>", "<cmd>silent !tmux neww tmux-sessionizer<CR>")
vim.keymap.set("n", "<C-f>", "<cmd>silent !tmux neww tmux-session-switcher<CR>")
