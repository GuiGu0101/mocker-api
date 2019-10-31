// 这里用到一个很实用的 npm 模块，用以在同一行打印文本
const logUpdate = require('log-update');
const color = require('colors-cli/safe');

// 封装的 ProgressBar 工具
class ProgressBar {
  constructor(options) {
    const { title, barLength, total } = options;
    // 两个基本参数(属性)
    this.title = title || 'Progress';    // 命令行开头的文字信息
    this.length = barLength || 25;           // 进度条的长度(单位：字符)，默认设为 25
    this.total = total || 0;
    this.completed = 0;
  }

  tick(description) {
    this.completed += 1;
    this.render({
      completed: this.completed,
      total: this.total,
      description: description
    })
  }

  update(opts) {
    const { completed, total, description } = opts;

    this.completed = completed || this.completed;
    this.total = total || this.total;
    this.render({
      completed: this.completed,
      total: this.total,
      description: description
    })
  }

  // 刷新进度条图案、文字的方法
  render(opts) {
    var percent = (opts.completed / opts.total).toFixed(4);  // 计算进度(子任务的 完成数 除以 总数)
    var cell_num = Math.floor(percent * this.length);       // 计算需要多少个 █ 符号来拼凑图案

    // 拼接黑色条
    var cell = '';
    for (var i = 0; i < cell_num; i++) {
      cell += ' ';
    }
    cell = color.green_b.black(cell)
    // 拼接灰色条
    var empty = '';
    for (var i = 0; i < this.length - cell_num; i++) {
      empty += ' ';
    }
    empty = color.white_b.black(empty)

    // 拼接最终文本
    var cmdText = this.title + ': ' + (100 * percent).toFixed(2) + '% ' + cell + empty + ' ' + opts.completed + '/' + opts.total;
    if (opts.description) {
      cmdText += `\n${opts.description}`
    }

    logUpdate(cmdText);

  };
  done() {
    logUpdate.clear();
    logUpdate.done();
  }
}

// 模块导出
module.exports = ProgressBar;