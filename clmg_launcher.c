#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <libgen.h>
#include <sys/stat.h>

int main(int argc, char *argv[]) {
    // 获取可执行文件所在目录
    char exe_path[4096];
    uint32_t size = sizeof(exe_path);
    if (_NSGetExecutablePath(exe_path, &size) != 0) {
        fprintf(stderr, "clmg: cannot resolve executable path\n");
        return 1;
    }

    char *dir = dirname(exe_path);
    char bun_path[4096];
    snprintf(bun_path, sizeof(bun_path), "%s/.clmg-bun", dir);

    // 如果启动器旁边没有 bun，回退到 PATH 中的 bun
    struct stat st;
    if (stat(bun_path, &st) != 0) {
        snprintf(bun_path, sizeof(bun_path), "%s/.bun/bin/bun", getenv("HOME"));
        if (stat(bun_path, &st) != 0) {
            strcpy(bun_path, "bun");
        }
    }

    // 构建参数: bun run <bundle.js> <user args...>
    char bundle_path[4096];
    snprintf(bundle_path, sizeof(bundle_path), "%s/.clmg-bundle.js", dir);

    int total = argc + 3;
    char **exec_argv = malloc((total + 1) * sizeof(char *));
    exec_argv[0] = bun_path;
    exec_argv[1] = (char *)"run";
    exec_argv[2] = bundle_path;
    for (int i = 1; i < argc; i++) {
        exec_argv[i + 2] = argv[i];
    }
    exec_argv[total] = NULL;

    execvp(bun_path, exec_argv);
    // execvp 只在失败时返回
    perror("clmg: failed to launch");
    return 127;
}
