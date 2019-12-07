/**
 * @author xshu
 * @date 2019-12-07
 */

const { ccclass, property } = cc._decorator;

@ccclass
class MapControl extends cc.Component {

    @property({
        type: cc.Node,
        tooltip: '目标节点，当mapContainer为null时，需要将该组件挂在目标节点，该节点默认为挂载节点'
    })
    public map: cc.Node = null;

    @property({
        type: cc.Node,
        tooltip: '当该节点为空时，需要将改组件挂在map节点上，该节点默认为挂载节点的父节点'
    })
    public mapContainer: cc.Node = null;

    @property(cc.Label)
    public scaleTime: cc.Label = null;

    @property({
        tooltip: '图片缩放最大scale'
    })
    public maxScale: number = 3;
    @property({
        tooltip: '图片缩放最小scale'
    })
    public minScale: number = 1;
    @property({
        tooltip: '单点触摸容忍误差'
    })
    public moveOffset: number = 2;

    public operLock: boolean = false; // 操作锁
    public isMoving: boolean = false; // 是否拖动地图flag
    public mapTouchList: any[] = []; // 触摸点容器
    public singleTouchCb: Function = null; // 单点回调函数

    protected start(): void {
        if (!this.map) this.map = this.node;
        if (!this.mapContainer) this.mapContainer = this.node.parent;
        this.addEvent();
    }

    private addEvent(): void {
        this.map.on(cc.Node.EventType.TOUCH_MOVE, (event: any) => {
            if (this.operLock) return; // 如果触摸操作暂时锁定则不响应
            let touches: any[] = event['getTouches'](); // 获取所有触摸点
            // 1.x当多点触摸的时候 第二个触摸点即使不在node上也能进来 而且target也是当前node
            // 通过rect是否包含当前触摸点来过滤无效的触摸点
            touches
                .filter(v => {
                    let startPos: cc.Vec2 = v.getStartLocation(); // 触摸点最初的位置
                    let worldPos: cc.Vec2 = this.mapContainer.convertToWorldSpaceAR(cc.Vec2.ZERO);
                    let worldRect: cc.Rect = cc.rect(
                        worldPos.x - this.mapContainer.width / 2,
                        worldPos.y - this.mapContainer.height / 2,
                        this.mapContainer.width,
                        this.mapContainer.height
                    );
                    return worldRect.contains(startPos);
                })
                .forEach(v => { // 将有效的触摸点放在容器里自行管理
                    let temp: any[] = this.mapTouchList.filter(v1 => v1.id === v.getID());
                    if (temp.length === 0) {
                        this.mapTouchList.push({ id: v.getID(), touch: v });
                    }
                })
                ;
            if (this.mapTouchList.length >= 2) { // 如果容器内触摸点数量超过1则为多点触摸，此处暂时不处理三点及以上的触摸点，可以根据需求来处理
                this.isMoving = true;
                this.dealTouchData(this.mapTouchList, this.map);
            } else if (this.mapTouchList.length === 1) {
                // sigle touch
                let touch: any = this.mapTouchList[0].touch;
                let startPos: cc.Vec2 = touch.getStartLocation();
                let nowPos: cc.Vec2 = touch.getLocation();
                // 有些设备单点过于灵敏，单点操作会触发TOUCH_MOVE回调，在这里作误差值判断
                if ((Math.abs(nowPos.x - startPos.x) <= this.moveOffset ||
                    Math.abs(nowPos.y - startPos.y) <= this.moveOffset) &&
                    !this.isMoving) {
                    return cc.log('sigle touch is not move');
                }
                let dir: cc.Vec2 = touch.getDelta();
                this.isMoving = true;
                this.dealMove(dir, this.map, this.mapContainer);
            }
        }, this);

        this.map.on(cc.Node.EventType.TOUCH_END, (event) => {
            if (this.operLock) return cc.log('operate is lock');
            // 需要自行管理touches队列, cocos 的多点触控并不可靠
            if (this.mapTouchList.length < 2) {
                if (!this.isMoving) {
                    let worldPos: cc.Vec2 = event['getLocation']();
                    let nodePos: cc.Vec2 = this.map.convertToNodeSpaceAR(worldPos);
                    this.dealSelect(nodePos);
                }
                this.isMoving = false; // 当容器中仅剩最后一个触摸点时讲移动flag还原
            };
            this.removeTouchFromContent(event, this.mapTouchList);
        }, this);

        this.map.on(cc.Node.EventType.TOUCH_CANCEL, (event) => {
            if (this.operLock) return;
            if (this.mapTouchList.length < 2) { // 当容器中仅剩最后一个触摸点时讲移动flag还原
                this.isMoving = false;
            };
            this.removeTouchFromContent(event, this.mapTouchList);
        }, this);
    }

    public removeTouchFromContent(event: any, content: any[]): void {
        let eventToucheIDs: number[] = event['getTouches']().map(v => v.getID());
        for (let len = content.length, i = len - 1; i >= 0; --i) {
            if (eventToucheIDs.indexOf(content[i].id) > -1)
                content.splice(i, 1); // 删除触摸
        }
    }

    private dealTouchData(touches: any[], target: cc.Node): void {
        let touch1: any = touches[0].touch;
        let touch2: any = touches[1].touch;
        let delta1: any = touch1.getDelta();
        let delta2: any = touch2.getDelta();
        let touchPoint1: cc.Vec2 = target.convertToNodeSpaceAR(touch1.getLocation());
        let touchPoint2: cc.Vec2 = target.convertToNodeSpaceAR(touch2.getLocation());
        let distance: cc.Vec2 = touchPoint1.sub(touchPoint2);
        let delta: cc.Vec2 = delta1.sub(cc.v2(delta2.x, delta2.y));
        let scale: number = 1;
        if (Math.abs(distance.x) > Math.abs(distance.y)) {
            scale = (distance.x + delta.x) / distance.x * target.scaleX;
        } else {
            scale = (distance.y + delta.y) / distance.y * target.scaleY;
        }
        let pos: cc.Vec2 = touchPoint2.add(cc.v2(distance.x / 2, distance.y / 2));
        // 滑轮缩放大小
        let scX: number = scale;
        // 当前缩放值与原来缩放值之差
        let disScale: number = scX - target.scaleX;
        // 当前点击的坐标与缩放值差像乘 
        let gapPos: cc.Vec2 = pos.scale(cc.v2(disScale, disScale));
        // 当前node坐标位置减去点击 点击坐标和缩放值的值
        let mapPos: cc.Vec2 = target.getPosition().sub(cc.v2(gapPos.x, gapPos.y));
        // 放大缩小
        if (!this.isOutRangeScale(scale)) {
            scale = (scale * 100 | 0) / 100;
            target.scale = scale;
            this.dealScalePos(mapPos, target);
        }
        scale = this.dealScaleRange(scale);
        this.scaleTime.string = `${scale * 100 | 0}%`;
    }

    private isOutRangeScale(scale: number): boolean {
        return (scale > this.maxScale || scale < this.minScale);
    }

    private dealScaleRange(scale: number): number {
        if (scale > this.maxScale) {
            return this.maxScale;
        } else if (scale < this.minScale) {
            return this.minScale;
        } else {
            return scale;
        }
    }

    private dealScalePos(pos: cc.Vec2, target: cc.Node): void {
        let container: cc.Node = this.mapContainer;
        let worldPos: cc.Vec2 = container.convertToWorldSpaceAR(pos);
        let nodePos: cc.Vec2 = container.convertToNodeSpaceAR(worldPos);
        let edge: any = this.calculateEdge(target, container, nodePos);
        edge.lBorderDelta > 0 && (pos.x -= edge.lBorderDelta);
        edge.rBorderDelta > 0 && (pos.x += edge.rBorderDelta);
        edge.uBorderDelta > 0 && (pos.y += edge.uBorderDelta);
        edge.dBorderDelta > 0 && (pos.y -= edge.dBorderDelta);
        if (target.scale === 1) pos = cc.Vec2.ZERO;
        target.position = pos;
    }

    private dealMove(dir: cc.Vec2, map: cc.Node, container: cc.Node): void {
        let worldPos: cc.Vec2 = map.convertToWorldSpaceAR(cc.Vec2.ZERO);
        let nodePos: cc.Vec2 = container.convertToNodeSpaceAR(worldPos);
        nodePos.x += dir.x;
        nodePos.y += dir.y;
        let edge: any = this.calculateEdge(map, container, nodePos);
        if (edge.lBorderDelta <= 0 && edge.rBorderDelta <= 0) {
            map.x += dir.x;
        }
        if (edge.uBorderDelta <= 0 && edge.dBorderDelta <= 0) {
            map.y += dir.y;
        }
    }

    public setSinglTouchCb(cb: Function): void {
        this.singleTouchCb = cb;
    }

    private dealSelect(nodePos: cc.Vec2): void {
        cc.log(`click map on cc.v2(${nodePos.x}, ${nodePos.y})`);
        // do sth
        if (this.singleTouchCb) this.singleTouchCb(nodePos);
    }

    // 计算map的四条边距离容器的距离
    public calculateEdge(target: cc.Node, container: cc.Node, nodePos: cc.Vec2): any {
        let realWidth: number = target.width * target.scaleX;
        let realHeight: number = target.height * target.scaleY;
        let lBorderDelta: number = (nodePos.x - realWidth / 2) + container.width / 2;
        let rBorderDelta: number = container.width / 2 - (realWidth / 2 + nodePos.x); // <= 0 safe
        let uBorderDelta: number = container.height / 2 - (realHeight / 2 + nodePos.y);
        let dBorderDelta: number = (nodePos.y - realHeight / 2) + container.height / 2;
        return { lBorderDelta, rBorderDelta, uBorderDelta, dBorderDelta };
    }
}

export = MapControl; 