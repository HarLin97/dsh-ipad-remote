/**
 * Copy for the remote-access settings section.
 *
 * Both dictionaries are complete records of the same key union, so adding a
 * key without translating it fails the type check rather than shipping a
 * half-translated page.
 * @module @harlin97/dsh-ipad-remote/client/locales
 */
/** Chinese dictionary — the source of the key union. */
export declare const zh: {
    readonly nav: "iPad 远程访问";
    readonly intro: "开启后，同一局域网或 Tailscale 网络里的设备可以打开这个 Harness 的同一个界面，入口由这个 PIN 把守。";
    readonly enableLabel: "允许远程访问";
    readonly enableHint: "关闭只停止监听，PIN 与配置都会保留。";
    readonly listening: "监听中";
    readonly stopped: "已停止";
    readonly portBusy: "端口被占用";
    readonly portBusyHint: "开关是打开的，但端口没能监听成功——通常是被别的程序占着。换端口或关掉占用者后重试。";
    readonly enabledToast: "远程访问已开启";
    readonly disabledToast: "远程访问已停止";
    readonly pinTitle: "访问 PIN";
    readonly pinLabel: "6 位数字 PIN";
    readonly pinPlaceholder: "6 位数字";
    readonly pinSet: "已设置";
    readonly pinUnset: "未设置";
    readonly pinSave: "设置 PIN";
    readonly pinInvalid: "PIN 必须是 6 位数字。";
    readonly pinSaved: "PIN 已更新";
    readonly pinHint: "iPad 第一次打开时需要输入这个 PIN。本页不会显示已设置的 PIN；改 PIN 不会踢掉已经解锁的设备——要踢掉请用下面的「全部撤销」。";
    readonly addressesTitle: "在 iPad 上打开";
    readonly addressesHint: "用 iPad 相机扫描二维码，或手动输入下面的地址。";
    readonly addressesEmpty: "还没有可用的地址：本机没有已启用的网络接口。";
    readonly copy: "复制";
    readonly copied: "地址已复制";
    readonly copyFailed: "复制失败，请手动选择地址";
    readonly qrLabel: "地址二维码";
    readonly sessionsTitle: "已解锁的设备";
    readonly sessionsEmpty: "还没有设备解锁。";
    readonly revoke: "全部撤销";
    readonly revokeConfirm: "确认全部撤销";
    readonly revoked: "已撤销全部设备";
    readonly issuedAt: "解锁于";
    readonly expiresAt: "有效期至";
    readonly storePath: "状态文件";
    readonly refresh: "刷新";
    readonly loading: "正在读取状态…";
    readonly loadFailed: "读取状态失败";
    readonly retry: "重试";
    readonly staleWarning: "后台刷新失败，下面是上一次成功读取的状态。";
    readonly actionFailed: "操作失败";
};
/** Key union every dictionary must cover. */
export type IpadRemoteKey = keyof typeof zh;
/** English dictionary. */
export declare const en: Record<IpadRemoteKey, string>;
