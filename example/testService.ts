import { defineService, defineServiceHandler, defineServiceHandlers, defineServiceMethod, defineServiceMethods, defineServiceSetup, defineServiceTimer, defineServiceTimers } from "~/composables";

export default defineService({
    setup() {

        this.hello()
        this.comp

        return {
            props: {
                a: 1
            }
        }
    },
    hooks: {
        onStart() {
            this.props.a
            this.hello()
        },
        onDestroy() {
        },
    },
    methods: {//付给自身
        hello() {
            this.props
            this.world()
        },
        world() {
        },
        echo(content: string) {

        }
    },
    handlers: {
        hello1() {
            this.hello()
            // this.echo()
        },
        world2(event) {
        }
    },
    timers: {
        sec: {
            delay: 10,
            setup() {

            }
        },
        abc: {
            delay: 100,
            setup() {

            }
        }
    }
})

defineServiceMethod(function () {

    this.components.test
})

defineServiceMethods({
    test() {
        this.test()
    }
})

defineServiceHandlers({
    test() {
        this.props
    },
    test2() {

    }
})


defineServiceHandler(function () {
})

defineServiceTimers({
    sec: {
        delay: 100,
        setup() {
            this.events
        }
    },
    hour: {
        interval: 3600 * 1000,
        setup() {
        }
    }
})

defineServiceTimer({
    delay: 1000,
    setup() {
        this.define
    }
})