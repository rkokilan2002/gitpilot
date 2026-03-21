import chalk from "chalk";

function printLine(line: string) {
  console.log(line);
}

export function success(msg: string) {
  printLine(chalk.green(`[OK] ${msg}`));
}

export function error(msg: string) {
  printLine(chalk.red(`[ERROR] ${msg}`));
}

export function warning(msg: string) {
  printLine(chalk.yellow(`[WARN] ${msg}`));
}

export function info(msg: string) {
  printLine(chalk.cyan(`[INFO] ${msg}`));
}

export function header(title: string) {
  printLine("");
  printLine(chalk.bold(title.toUpperCase()));
}

export function section(title: string) {
  printLine("");
  printLine(chalk.dim(title));
}

export function list(items: string[]) {
  items.forEach((item) => printLine(`- ${item}`));
}
