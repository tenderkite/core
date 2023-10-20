import { defineComponent, defineService } from "~/composables";

export default defineComponent({
    setup() {

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
    timers: {
        sec: {
            delay: 10,
            setup() {
                this.service.remote("world").create
            }
        }
    }
})
