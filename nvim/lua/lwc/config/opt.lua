-- Display line number
vim.opt.nu = true
-- Show relative line number
vim.opt.relativenumber = true

-- Use 4 space tab
vim.opt.tabstop = 4
vim.opt.softtabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

-- Make sure the indent is still correct when go to next line
vim.opt.smartindent = true

-- No wrap
vim.opt.wrap = false

-- No swap or backup files
vim.opt.swapfile = false
vim.opt.backup = false

-- Make sure the undo information is saved
vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.opt.undofile = true

-- Disable highlight after a search is entered
vim.opt.hlsearch = false
-- When typing for a search, highlight those are matched
vim.opt.incsearch = true

-- Instead of the 256 color, it allows neovim to use all 24 bit color
vim.opt.termguicolors = true

-- Always keep at least 8 line in the bottom and top
vim.opt.scrolloff = 8
-- Show signs of the status of a single line
vim.opt.signcolumn = "yes"
-- Tell nvim to respect @ in filenames
vim.opt.isfname:append("@-@")

-- Make neovim faster i guess
vim.opt.updatetime = 50

vim.opt.winborder = "rounded"
vim.opt.spell = true
