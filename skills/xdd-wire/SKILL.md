---
name: xdd-wire
description: xdd-wire，高质量前端的设计图师：svg wireframe。 一般的前端开发流程： xdd-wire -> xdd-plan -> xdd-execute
---

# xdd-wire
通过先svg设计好(`./.xdd/wire`)，然后再进行前端实现关注页面设计

## def 设计svg
1. 读取 `.xdd/bdd/` 中的 Feature/Scenario，提取页面

## def 实现前端
1. 根据设计的 svg，使用前端技术栈实现页面
2. 每个页面组件都要有对应的测试用例，确保实现符合设计

## workflow
设计svg()

do 实现前端()
  then playwright cli 截图，对比 svg 实现
  if 相同
    then break
  else
    if svg 有误
      then go to 设计svg()
    else
      then 继续调整实现，直到截图与 svg 相同
