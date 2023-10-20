import { defineMiddleware } from "~/composables";

export default defineMiddleware({
    setup() {
        return () => {
            console.log("this is middleware:", this.name)
        }
    }
})

defineMiddleware(function () {
    console.log("this is middleware:", this.name)
})